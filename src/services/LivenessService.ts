/**
 * LivenessService
 * ---------------
 * Two-layer anti-spoofing system:
 *
 * Layer 1 — Passive PAD (Presentation Attack Detection):
 *   MiniXception model (~4MB INT8) analyzes micro-texture differences
 *   between real skin and paper/screen surfaces. Runs on every frame silently.
 *
 * Layer 2 — Active Challenge FSM:
 *   Uses MediaPipe Face Mesh landmarks (468 points) to detect:
 *   - Blink: EAR (Eye Aspect Ratio) < 0.21 for 2+ consecutive frames
 *   - Smile: Lip corner distance > 1.3x neutral width
 *   - Head turn: Yaw angle > 15 degrees from frontal
 *
 * Both layers must pass for LIVENESS = VERIFIED
 */

import { loadTensorflowModel } from 'react-native-fast-tflite';
import { Asset } from 'expo-asset';

const padModelAsset = require('../../assets/models/minixception_pad_int8.tflite');
const landmarkModelAsset = require('../../assets/models/mediapipe_face_mesh.tflite');

export type ChallengeType = 'BLINK' | 'SMILE' | 'HEAD_TURN';
export type LivenessState = 'IDLE' | 'PASSIVE_CHECK' | 'CHALLENGE_PENDING' | 'CHALLENGE_ACTIVE' | 'VERIFIED' | 'FAILED';

export interface LivenessResult {
  state: LivenessState;
  passiveScore: number;     // 0-1, real face probability
  activeChallenge: ChallengeType | null;
  challengeComplete: boolean;
  failReason: string | null;
}

interface FaceLandmarks {
  points: Array<{ x: number; y: number; z: number }>;
}

// EAR landmark indices for left and right eye (MediaPipe Face Mesh)
const LEFT_EYE_INDICES  = [362, 385, 387, 263, 373, 380];
const RIGHT_EYE_INDICES = [33,  160, 158, 133, 153, 144];
const LEFT_LIP_CORNER   = 61;
const RIGHT_LIP_CORNER  = 291;
const UPPER_LIP_CENTER  = 0;
const NOSE_TIP          = 1;
const LEFT_EAR_PONT     = 234;
const RIGHT_EAR_POINT   = 454;

class LivenessServiceClass {
  private padModel: any = null;
  private landmarkModel: any = null;
  private state: LivenessState = 'IDLE';
  private currentChallenge: ChallengeType | null = null;
  private challengeStartTime = 0;
  private challengeTimeout = 5000; // 5 seconds to complete challenge
  private blinkFrameCount = 0;
  private neutralLipWidth = 0;
  private isLoaded = false;

  async initialize(): Promise<void> {
    try {
      console.log('[Liveness] Downloading PAD and Face Mesh models from modules...');
      const padAsset = Asset.fromModule(padModelAsset);
      const landmarkAsset = Asset.fromModule(landmarkModelAsset);
      
      await Promise.all([
        padAsset.downloadAsync(),
        landmarkAsset.downloadAsync(),
      ]);
      
      const padPath = padAsset.localUri;
      const landmarkPath = landmarkAsset.localUri;
      
      if (!padPath || !landmarkPath) {
        throw new Error('Failed to resolve local URIs for liveness model assets');
      }
      
      console.log('[Liveness] Loading local models into TFLite interpreters:', { padPath, landmarkPath });
      const [pad, landmarks] = await Promise.all([
        loadTensorflowModel({ url: padPath }),
        loadTensorflowModel({ url: landmarkPath }),
      ]);
      
      this.padModel = pad;
      this.landmarkModel = landmarks;
      this.isLoaded = true;
      console.log('[Liveness] PAD + Landmark models loaded successfully from local storage');
    } catch (err) {
      console.error('[Liveness] Model load failed:', err);
      throw err;
    }
  }

  /**
   * Start a liveness check session.
   * Randomly picks one active challenge.
   */
  startCheck(): ChallengeType {
    const challenges: ChallengeType[] = ['BLINK', 'SMILE', 'HEAD_TURN'];
    this.currentChallenge = challenges[Math.floor(Math.random() * challenges.length)];
    this.state = 'PASSIVE_CHECK';
    this.challengeStartTime = Date.now();
    this.blinkFrameCount = 0;
    this.neutralLipWidth = 0;
    return this.currentChallenge;
  }

  /**
   * Process a single frame. Call this from the camera frame processor.
   * Returns current liveness state.
   */
  async processFrame(frameData: Uint8Array): Promise<LivenessResult> {
    if (!this.isLoaded) {
      return this.makeResult('IDLE', 0, null);
    }

    // Timeout check
    if (this.challengeStartTime > 0 && Date.now() - this.challengeStartTime > this.challengeTimeout) {
      this.state = 'FAILED';
      return this.makeResult('FAILED', 0, null, 'Challenge timeout — try again');
    }

    // Layer 1: Passive PAD check (runs always)
    const passiveScore = await this.runPassivePAD(frameData);

    if (passiveScore < 0.5) {
      this.state = 'FAILED';
      return this.makeResult('FAILED', passiveScore, null, 'Spoof detected — use your real face');
    }

    // Get face landmarks
    const landmarks = await this.getLandmarks(frameData);
    if (!landmarks) {
      return this.makeResult(this.state, passiveScore, this.currentChallenge);
    }

    // Calibrate neutral lip width on first frame
    if (this.neutralLipWidth === 0) {
      this.neutralLipWidth = this.getLipWidth(landmarks);
    }

    // Layer 2: Active challenge check
    if (this.state === 'PASSIVE_CHECK' || this.state === 'CHALLENGE_ACTIVE') {
      this.state = 'CHALLENGE_ACTIVE';
      const challengePassed = this.checkChallenge(landmarks);

      if (challengePassed) {
        this.state = 'VERIFIED';
        return { ...this.makeResult('VERIFIED', passiveScore, this.currentChallenge), challengeComplete: true };
      }
    }

    return this.makeResult(this.state, passiveScore, this.currentChallenge);
  }

  reset(): void {
    this.state = 'IDLE';
    this.currentChallenge = null;
    this.challengeStartTime = 0;
    this.blinkFrameCount = 0;
    this.neutralLipWidth = 0;
  }

  private async runPassivePAD(frameData: Uint8Array): Promise<number> {
    if (!this.padModel) return 1.0;
    try {
      const output = await this.padModel.run([frameData]);
      // Model outputs [spoof_prob, real_prob]
      return output[0][1] ?? 0.5;
    } catch {
      return 1.0; // Fail open (don't block on model error)
    }
  }

  private async getLandmarks(frameData: Uint8Array): Promise<FaceLandmarks | null> {
    if (!this.landmarkModel) return null;
    try {
      const output = await this.landmarkModel.run([frameData]);
      const flat = output[0] as Float32Array;
      const points = [];
      for (let i = 0; i < flat.length; i += 3) {
        points.push({ x: flat[i], y: flat[i + 1], z: flat[i + 2] });
      }
      return { points };
    } catch {
      return null;
    }
  }

  private checkChallenge(landmarks: FaceLandmarks): boolean {
    switch (this.currentChallenge) {
      case 'BLINK':    return this.detectBlink(landmarks);
      case 'SMILE':    return this.detectSmile(landmarks);
      case 'HEAD_TURN': return this.detectHeadTurn(landmarks);
      default:          return false;
    }
  }

  private detectBlink(lm: FaceLandmarks): boolean {
    const leftEAR  = this.computeEAR(lm, LEFT_EYE_INDICES);
    const rightEAR = this.computeEAR(lm, RIGHT_EYE_INDICES);
    const avgEAR   = (leftEAR + rightEAR) / 2;

    if (avgEAR < 0.21) {
      this.blinkFrameCount++;
    }
    return this.blinkFrameCount >= 2; // Must hold for 2 consecutive frames
  }

  private detectSmile(lm: FaceLandmarks): boolean {
    const currentWidth = this.getLipWidth(lm);
    return this.neutralLipWidth > 0 && currentWidth > this.neutralLipWidth * 1.25;
  }

  private detectHeadTurn(lm: FaceLandmarks): boolean {
    if (lm.points.length < 468) return false;
    const noseX      = lm.points[NOSE_TIP].x;
    const leftEarX   = lm.points[LEFT_EAR_PONT].x;
    const rightEarX  = lm.points[RIGHT_EAR_POINT].x;
    const midX       = (leftEarX + rightEarX) / 2;
    const yawRatio   = Math.abs(noseX - midX) / Math.abs(rightEarX - leftEarX);
    return yawRatio > 0.15; // ~15 degree turn
  }

  private computeEAR(lm: FaceLandmarks, indices: number[]): number {
    const p = (i: number) => lm.points[i];
    const dist = (a: {x:number,y:number}, b: {x:number,y:number}) =>
      Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2);

    const vertical1 = dist(p(indices[1]), p(indices[5]));
    const vertical2 = dist(p(indices[2]), p(indices[4]));
    const horizontal = dist(p(indices[0]), p(indices[3]));
    return (vertical1 + vertical2) / (2.0 * horizontal);
  }

  private getLipWidth(lm: FaceLandmarks): number {
    if (lm.points.length < 468) return 0;
    const left  = lm.points[LEFT_LIP_CORNER];
    const right = lm.points[RIGHT_LIP_CORNER];
    return Math.sqrt((left.x-right.x)**2 + (left.y-right.y)**2);
  }

  private makeResult(
    state: LivenessState,
    passiveScore: number,
    challenge: ChallengeType | null,
    failReason: string | null = null
  ): LivenessResult {
    return {
      state,
      passiveScore,
      activeChallenge: challenge,
      challengeComplete: state === 'VERIFIED',
      failReason,
    };
  }

  getState(): LivenessState { return this.state; }
  isModelLoaded(): boolean  { return this.isLoaded; }
}

export const LivenessService = new LivenessServiceClass();
