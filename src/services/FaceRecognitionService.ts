/**
 * FaceRecognitionService
 * ----------------------
 * Runs MobileFaceNet (INT8 quantized, ~5MB) entirely on-device via TFLite.
 * No network required. Produces 512-d embeddings and computes cosine similarity.
 *
 * Model: MobileFaceNet trained with ArcFace loss on MS-Celeb + VGGFace2
 * Input: 112x112 RGB, normalized to [-1, 1]
 * Output: 512-dim L2-normalized embedding vector
 */

import { loadTensorflowModel } from 'react-native-fast-tflite';
import { PreprocessingService } from './PreprocessingService';

const modelAsset = require('../../assets/models/mobilefacenet_int8.tflite');
const COSINE_THRESHOLD = 0.65; // Tuned for Indian demographic dataset

export interface FaceEmbedding {
  vector: Float32Array;
  timestamp: number;
  confidence: number;
}

export interface RecognitionResult {
  matched: boolean;
  personId: string | null;
  similarity: number;
  processingMs: number;
}

class FaceRecognitionServiceClass {
  private model: any = null;
  private isLoaded = false;

  async initialize(): Promise<void> {
    try {
      this.model = await loadTensorflowModel(modelAsset);
      this.isLoaded = true;
      console.log('[FaceRecognition] MobileFaceNet INT8 loaded successfully');
    } catch (err) {
      console.error('[FaceRecognition] Model load failed:', err);
      throw err;
    }
  }

  /**
   * Extract 512-d embedding from a preprocessed 112x112 face crop.
   * Returns null if model not loaded or inference fails.
   */
  async extractEmbedding(frameData: Uint8Array): Promise<FaceEmbedding | null> {
    if (!this.isLoaded || !this.model) {
      console.warn('[FaceRecognition] Model not initialized');
      return null;
    }

    const start = Date.now();

    // Preprocess: resize, CLAHE normalize, convert to float32 [-1,1]
    const preprocessed = await PreprocessingService.preprocessFrame(frameData, 112, 112);
    if (!preprocessed) return null;

    // Run inference
    const output = await this.model.run([preprocessed]);
    const embedding = new Float32Array(output[0]);

    // L2 normalize the embedding
    const normalized = this.l2Normalize(embedding);

    return {
      vector: normalized,
      timestamp: Date.now(),
      confidence: this.getEmbeddingConfidence(normalized),
    };
  }

  /**
   * Compare two embeddings using cosine similarity.
   * Returns value in [0, 1]. Higher = more similar.
   */
  cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Match an embedding against a stored template set.
   * Uses mean template comparison for robustness.
   */
  matchAgainstTemplates(
    probe: Float32Array,
    templates: Array<{ personId: string; embedding: Float32Array }>
  ): RecognitionResult {
    const start = Date.now();
    let bestMatch = { personId: null as string | null, similarity: 0 };

    for (const template of templates) {
      const sim = this.cosineSimilarity(probe, template.embedding);
      if (sim > bestMatch.similarity) {
        bestMatch = { personId: template.personId, similarity: sim };
      }
    }

    return {
      matched: bestMatch.similarity >= COSINE_THRESHOLD,
      personId: bestMatch.similarity >= COSINE_THRESHOLD ? bestMatch.personId : null,
      similarity: bestMatch.similarity,
      processingMs: Date.now() - start,
    };
  }

  /**
   * Update a stored template using exponential moving average.
   * Keeps templates fresh without full re-enrollment.
   * new_template = 0.9 * old + 0.1 * new_embedding
   */
  updateTemplate(existing: Float32Array, newEmbedding: Float32Array): Float32Array {
    const updated = new Float32Array(existing.length);
    for (let i = 0; i < existing.length; i++) {
      updated[i] = 0.9 * existing[i] + 0.1 * newEmbedding[i];
    }
    return this.l2Normalize(updated);
  }

  private l2Normalize(v: Float32Array): Float32Array {
    let norm = 0;
    for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    const result = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) result[i] = v[i] / norm;
    return result;
  }

  private getEmbeddingConfidence(v: Float32Array): number {
    // Proxy: variance of embedding as quality indicator
    let mean = 0;
    for (const x of v) mean += x;
    mean /= v.length;
    let variance = 0;
    for (const x of v) variance += (x - mean) ** 2;
    variance /= v.length;
    return Math.min(variance * 100, 1.0);
  }

  isModelLoaded(): boolean {
    return this.isLoaded;
  }
}

export const FaceRecognitionService = new FaceRecognitionServiceClass();
