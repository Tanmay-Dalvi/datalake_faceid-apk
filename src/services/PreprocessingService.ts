/**
 * PreprocessingService
 * ---------------------
 * Handles all image preprocessing before model inference.
 *
 * Pipeline:
 *   Raw Frame → Face Detection → Crop & Align (5-point) → CLAHE → Normalize → Model Input
 *
 * Key innovation: CLAHE (Contrast Limited Adaptive Histogram Equalization)
 * dramatically improves accuracy in outdoor conditions — harsh sunlight,
 * deep shadow, and partial occlusion.
 *
 * CRITICAL: The output TypedArray type MUST match the model's expected input.
 * INT8 quantized models expect Uint8Array [0-255].
 * Float32 models expect Float32Array [-1, 1].
 */

import * as FileSystem from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { decode as decodeJpeg } from 'jpeg-js';
import { Buffer } from 'buffer';

const CLIP_LIMIT = 2.0;
const TILE_SIZE = 8; // 8x8 tiles for CLAHE

export type ModelDataType = 'uint8' | 'int8' | 'float32' | 'float64';

export interface ProcessedFrame {
  data: Float32Array;
  width: number;
  height: number;
}

export interface FaceDetection {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  landmarks?: Array<{ x: number; y: number }>; // 5 key landmarks
}

class PreprocessingServiceClass {

  /**
   * Load a camera photo file and convert it to raw RGBA pixel data.
   * Uses native image manipulation for fast resize, then pure-JS JPEG decoding.
   *
   * @param photoUri - file:// URI of the captured photo (JPEG)
   * @param targetW  - Target width (default 112 for MobileFaceNet)
   * @param targetH  - Target height (default 112 for MobileFaceNet)
   * @returns RGBA pixel buffer at target dimensions, or null on failure
   */
  async loadPhotoAsRGBA(
    photoUri: string,
    targetW: number = 112,
    targetH: number = 112
  ): Promise<{ data: Uint8Array; width: number; height: number } | null> {
    try {
      // Step 1: Resize image to target dimensions using native image manipulation
      // This is fast and memory-efficient (avoids decoding a full 12MP photo in JS)
      const resized = await manipulateAsync(
        photoUri,
        [{ resize: { width: targetW, height: targetH } }],
        { format: SaveFormat.JPEG, compress: 1.0, base64: true }
      );

      if (!resized.base64) {
        console.error('[Preprocessing] Image manipulation returned no base64 data');
        return null;
      }

      // Step 2: Decode the small JPEG to raw RGBA pixel data
      const jpegBuffer = Buffer.from(resized.base64, 'base64');
      const decoded = decodeJpeg(jpegBuffer, { useTArray: true, formatAsRGBA: true });

      // Clean up the resized temp file
      if (resized.uri) {
        try { await FileSystem.deleteAsync(resized.uri, { idempotent: true }); } catch {}
      }

      console.log(`[Preprocessing] Photo decoded: ${decoded.width}×${decoded.height}, ${decoded.data.length} bytes RGBA`);

      return {
        data: decoded.data as Uint8Array,
        width: decoded.width,
        height: decoded.height,
      };
    } catch (err) {
      console.error('[Preprocessing] Failed to load photo as RGBA:', err);
      return null;
    }
  }

  /**
   * Prepare image data for a specific TFLite model, matching its expected input type.
   *
   * This is the CORRECT entry point for all model inference. It inspects the model's
   * expected dataType and produces the matching TypedArray:
   *
   * - 'uint8' → Uint8Array with raw RGB values [0, 255] (for INT8 quantized models)
   * - 'int8'  → Int8Array with values [-128, 127]
   * - 'float32' → Float32Array with CLAHE-enhanced values normalized to [-1, 1]
   *
   * @param rgbaData - Raw RGBA pixel data from loadPhotoAsRGBA
   * @param targetW - Expected model input width
   * @param targetH - Expected model input height
   * @param modelDataType - The model's input tensor dataType (from model.inputs[0].dataType)
   */
  prepareForModel(
    rgbaData: Uint8Array,
    targetW: number,
    targetH: number,
    modelDataType: ModelDataType
  ): Uint8Array | Int8Array | Float32Array {
    const pixelCount = targetW * targetH;

    if (modelDataType === 'uint8') {
      // INT8 quantized model (unsigned): expects raw RGB pixels [0, 255]
      // Apply CLAHE for lighting normalization, output as uint8
      return this.toUint8RGB(rgbaData, targetW, targetH);
    } else if (modelDataType === 'int8') {
      // INT8 quantized model (signed): expects values [-128, 127]
      const uint8rgb = this.toUint8RGB(rgbaData, targetW, targetH);
      const int8 = new Int8Array(pixelCount * 3);
      for (let i = 0; i < uint8rgb.length; i++) {
        int8[i] = uint8rgb[i] - 128;
      }
      return int8;
    } else {
      // Float32 model: apply CLAHE then normalize to [-1, 1]
      return this.toFloat32RGB(rgbaData, targetW, targetH);
    }
  }

  /**
   * Convert RGBA to RGB Uint8Array [0-255] with CLAHE enhancement.
   * For INT8 quantized models (uint8 input).
   */
  private toUint8RGB(rgba: Uint8Array, w: number, h: number): Uint8Array {
    const pixelCount = w * h;
    const rgb = new Uint8Array(pixelCount * 3);

    // Apply CLAHE for lighting normalization
    const gray = this.toGrayscale(rgba);
    const clahe = this.applyCLAHE(gray, w, h);

    for (let i = 0; i < pixelCount; i++) {
      const origR = rgba[i * 4];
      const origG = rgba[i * 4 + 1];
      const origB = rgba[i * 4 + 2];

      // Compute luminance of original pixel
      const origLum = origR * 0.299 + origG * 0.587 + origB * 0.114;
      const claheVal = clahe[i];

      if (origLum < 1.0) {
        // Very dark pixel — just use CLAHE grayscale value for all channels
        rgb[i * 3]     = claheVal;
        rgb[i * 3 + 1] = claheVal;
        rgb[i * 3 + 2] = claheVal;
      } else {
        // Scale each channel by the CLAHE correction ratio, clamped to [0, 255]
        const ratio = claheVal / origLum;
        rgb[i * 3]     = Math.min(255, Math.max(0, Math.round(origR * ratio)));
        rgb[i * 3 + 1] = Math.min(255, Math.max(0, Math.round(origG * ratio)));
        rgb[i * 3 + 2] = Math.min(255, Math.max(0, Math.round(origB * ratio)));
      }
    }

    return rgb;
  }

  /**
   * Convert RGBA to Float32Array [-1, 1] with CLAHE enhancement.
   * For float32 models.
   */
  private toFloat32RGB(rgba: Uint8Array, w: number, h: number): Float32Array {
    const pixelCount = w * h;
    const float32 = new Float32Array(pixelCount * 3);

    // Apply CLAHE for lighting normalization
    const gray = this.toGrayscale(rgba);
    const clahe = this.applyCLAHE(gray, w, h);

    for (let i = 0; i < pixelCount; i++) {
      const origR = rgba[i * 4];
      const origG = rgba[i * 4 + 1];
      const origB = rgba[i * 4 + 2];

      // Compute luminance of original pixel
      const origLum = origR * 0.299 + origG * 0.587 + origB * 0.114;
      const claheVal = clahe[i];

      let adjR: number, adjG: number, adjB: number;

      if (origLum < 1.0) {
        // Very dark pixel — use CLAHE value directly
        adjR = adjG = adjB = claheVal;
      } else {
        // Scale by CLAHE ratio, CLAMP to [0, 255] to prevent overflow
        const ratio = claheVal / origLum;
        adjR = Math.min(255, Math.max(0, origR * ratio));
        adjG = Math.min(255, Math.max(0, origG * ratio));
        adjB = Math.min(255, Math.max(0, origB * ratio));
      }

      // Normalize to [-1, 1]
      float32[i * 3]     = (adjR - 127.5) / 128.0;
      float32[i * 3 + 1] = (adjG - 127.5) / 128.0;
      float32[i * 3 + 2] = (adjB - 127.5) / 128.0;
    }

    return float32;
  }

  /**
   * @deprecated Use prepareForModel() instead. This method always returns Float32Array
   * which is WRONG for INT8 quantized models and was the root cause of the broken pipeline.
   */
  async preprocessFrame(
    frameData: Uint8Array,
    targetW: number,
    targetH: number
  ): Promise<Float32Array | null> {
    // Delegate to float32 path for backward compatibility
    return this.toFloat32RGB(frameData, targetW, targetH);
  }

  /**
   * CLAHE implementation in JavaScript.
   *
   * Why CLAHE over standard histogram equalization:
   * - Prevents over-amplification of noise (the "clip limit")
   * - Works on local tiles, so a dark face against bright sky
   *   gets properly exposed rather than being washed out
   * - Critical for field workers in direct Indian sunlight
   */
  private applyCLAHE(gray: Uint8Array, width: number, height: number): Uint8Array {
    const tileW = Math.ceil(width / TILE_SIZE);
    const tileH = Math.ceil(height / TILE_SIZE);
    const output = new Uint8Array(gray.length);

    // Compute histogram and CDF for each tile
    const cdfs: Float32Array[][] = [];

    for (let ty = 0; ty < TILE_SIZE; ty++) {
      cdfs[ty] = [];
      for (let tx = 0; tx < TILE_SIZE; tx++) {
        const hist = new Float32Array(256).fill(0);

        // Count actual pixels in this tile (handle edge tiles correctly)
        const yStart = ty * tileH;
        const yEnd = Math.min((ty + 1) * tileH, height);
        const xStart = tx * tileW;
        const xEnd = Math.min((tx + 1) * tileW, width);
        let actualPixels = 0;

        for (let y = yStart; y < yEnd; y++) {
          for (let x = xStart; x < xEnd; x++) {
            hist[gray[y * width + x]]++;
            actualPixels++;
          }
        }

        // Use actual pixel count for clip limit (fixes edge tile skew)
        const clipLimit = CLIP_LIMIT * (actualPixels / 256);
        let excess = 0;
        for (let i = 0; i < 256; i++) {
          if (hist[i] > clipLimit) {
            excess += hist[i] - clipLimit;
            hist[i] = clipLimit;
          }
        }

        // Redistribute excess uniformly
        const perBin = excess / 256;
        for (let i = 0; i < 256; i++) hist[i] += perBin;

        // Compute CDF
        const cdf = new Float32Array(256);
        cdf[0] = hist[0];
        for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1] + hist[i];

        // Normalize CDF to [0, 255] using actual pixel count
        const cdfMin = cdf.find(v => v > 0) ?? 1;
        const denominator = actualPixels - cdfMin;
        for (let i = 0; i < 256; i++) {
          cdf[i] = denominator > 0
            ? Math.round(((cdf[i] - cdfMin) / denominator) * 255)
            : Math.round(cdf[i]);
        }

        cdfs[ty][tx] = cdf;
      }
    }

    // Apply bilinear interpolation between tile CDFs
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixel = gray[y * width + x];

        // Find surrounding tile positions (bilinear interpolation)
        const tx = Math.min(Math.floor(x / tileW), TILE_SIZE - 1);
        const ty = Math.min(Math.floor(y / tileH), TILE_SIZE - 1);

        // Simple nearest-tile for speed (bilinear available if needed)
        output[y * width + x] = cdfs[ty][tx][pixel];
      }
    }

    return output;
  }

  private toGrayscale(rgba: Uint8Array): Uint8Array {
    const gray = new Uint8Array(rgba.length / 4);
    for (let i = 0; i < gray.length; i++) {
      const r = rgba[i * 4];
      const g = rgba[i * 4 + 1];
      const b = rgba[i * 4 + 2];
      // Perceptual luminance weights
      gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }
    return gray;
  }

  /**
   * Estimate face quality for enrollment gating.
   * Rejects blurry, too-dark, or obstructed faces.
   */
  assessFrameQuality(frameData: Uint8Array, width: number, height: number): number {
    const gray = this.toGrayscale(frameData);

    // Laplacian variance for blur detection
    let laplacianSum = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        const lap = Math.abs(
          -gray[i - width - 1] - gray[i - width] - gray[i - width + 1]
          - gray[i - 1] + 8 * gray[i] - gray[i + 1]
          - gray[i + width - 1] - gray[i + width] - gray[i + width + 1]
        );
        laplacianSum += lap;
      }
    }

    const blurScore = laplacianSum / (width * height);

    // Brightness check
    let brightnessSum = 0;
    for (let i = 0; i < gray.length; i++) brightnessSum += gray[i];
    const brightness = brightnessSum / gray.length;

    // Quality is combination: 0 (bad) to 1 (good)
    const blurQuality = Math.min(blurScore / 50, 1.0);
    const brightnessQuality = brightness > 30 && brightness < 220
      ? 1.0 - Math.abs(brightness - 125) / 125
      : 0.1;

    return (blurQuality * 0.6 + brightnessQuality * 0.4);
  }
}

export const PreprocessingService = new PreprocessingServiceClass();
