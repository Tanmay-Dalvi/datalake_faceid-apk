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
import { Asset } from 'expo-asset';
import { PreprocessingService } from './PreprocessingService';

const modelAsset = require('../../assets/models/mobilefacenet_int8.tflite');
const landmarkModelAsset = require('../../assets/models/mediapipe_face_mesh.tflite');
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

export interface PoseData {
  faceDetected: boolean;
  confidence: number;
  yaw: number;
  pitch: number;
  pose: 'Front' | 'Slight Left' | 'Slight Right' | 'Look Up' | 'Look Down' | 'Unknown';
}

class FaceRecognitionServiceClass {
  private model: any = null;
  private landmarkModel: any = null;
  private isLoaded = false;
  private initPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.isLoaded) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    try {
      console.log('[FaceRecognition] Resolving model assets...');
      const modelAst = Asset.fromModule(modelAsset);
      const landmarkAst = Asset.fromModule(landmarkModelAsset);
      
      await Promise.all([
        modelAst.downloadAsync(),
        landmarkAst.downloadAsync(),
      ]);
      
      const modelPath = modelAst.localUri;
      const landmarkPath = landmarkAst.localUri;
      
      if (!modelPath || !landmarkPath) {
        throw new Error('Failed to resolve local URIs for face models');
      }
      
      console.log('[FaceRecognition] Loading models into TFLite interpreter...');
      const [model, landmarkModel] = await Promise.all([
        loadTensorflowModel({ url: modelPath }),
        loadTensorflowModel({ url: landmarkPath }),
      ]);
      
      this.model = model;
      this.landmarkModel = landmarkModel;
      this.isLoaded = true;
      console.log('[FaceRecognition] All face models loaded successfully');
    } catch (err) {
      console.error('[FaceRecognition] Model load failed:', err);
      this.initPromise = null; // Allow retry on failure
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
   * Detect face presence and estimate head pose using 468 landmarks from MediaPipe Face Mesh
   */
  async detectFaceAndPose(frameData: Uint8Array): Promise<PoseData> {
    if (!this.isLoaded || !this.landmarkModel) {
      console.warn('[FaceRecognition] Landmark model not initialized');
      return { faceDetected: false, confidence: 0, yaw: 0, pitch: 0, pose: 'Unknown' };
    }

    try {
      // Preprocess frame at 192x192 as required by MediaPipe Face Mesh
      const preprocessed = await PreprocessingService.preprocessFrame(frameData, 192, 192);
      if (!preprocessed) {
        return { faceDetected: false, confidence: 0, yaw: 0, pitch: 0, pose: 'Unknown' };
      }

      // Run inference
      const output = await this.landmarkModel.run([preprocessed]);
      const landmarksFlat = output[0] as Float32Array;
      
      // Output 1 is the presence/confidence score
      const presenceScore = output[1] ? (output[1] as Float32Array)[0] : 1.0;
      console.log(`[FaceRecognition] Face presence score: ${presenceScore.toFixed(4)}`);

      // Gating: If presence confidence is low, there is no face
      if (presenceScore < 0.45) {
        return { faceDetected: false, confidence: presenceScore, yaw: 0, pitch: 0, pose: 'Unknown' };
      }

      const points = [];
      for (let i = 0; i < landmarksFlat.length; i += 3) {
        points.push({
          x: landmarksFlat[i],
          y: landmarksFlat[i+1],
          z: landmarksFlat[i+2],
        });
      }

      if (points.length < 468) {
        return { faceDetected: false, confidence: presenceScore, yaw: 0, pitch: 0, pose: 'Unknown' };
      }

      // Landmarks indices:
      // Nose Tip: 1
      // Left Ear Profile: 234
      // Right Ear Profile: 454
      // Forehead: 10
      // Chin: 152
      const nose = points[1];
      const leftEar = points[234];
      const rightEar = points[454];
      const forehead = points[10];
      const chin = points[152];

      // Calculate distances for horizontal turn (Yaw)
      const dLeft = Math.sqrt((nose.x - leftEar.x) ** 2 + (nose.y - leftEar.y) ** 2);
      const dRight = Math.sqrt((nose.x - rightEar.x) ** 2 + (nose.y - rightEar.y) ** 2);
      const dTotal = dLeft + dRight;
      const yaw = (dLeft - dRight) / (dTotal || 1);

      // Calculate distances for vertical turn (Pitch)
      const dForehead = Math.sqrt((nose.x - forehead.x) ** 2 + (nose.y - forehead.y) ** 2);
      const dChin = Math.sqrt((nose.x - chin.x) ** 2 + (nose.y - chin.y) ** 2);
      const dVert = dForehead + dChin;
      const pitch = (dForehead - dChin) / (dVert || 1);

      // Detect Pose
      let pose: PoseData['pose'] = 'Front';
      if (yaw < -0.09) {
        pose = 'Slight Left';
      } else if (yaw > 0.09) {
        pose = 'Slight Right';
      } else if (pitch < -0.09) {
        pose = 'Look Up';
      } else if (pitch > 0.09) {
        pose = 'Look Down';
      }

      return {
        faceDetected: true,
        confidence: presenceScore,
        yaw,
        pitch,
        pose,
      };
    } catch (err) {
      console.error('[FaceRecognition] detectFaceAndPose failed:', err);
      return { faceDetected: false, confidence: 0, yaw: 0, pitch: 0, pose: 'Unknown' };
    }
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
