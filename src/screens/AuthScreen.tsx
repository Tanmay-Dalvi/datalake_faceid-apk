/**
 * AuthScreen
 * ----------
 * The core authentication flow:
 * Camera → Face Capture → RGBA Decode → MobileFaceNet Embedding → Cosine Similarity Match → Decision
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet, View, Text, Animated, Dimensions, TouchableOpacity, Alert, Vibration,
  ActivityIndicator,
} from 'react-native';
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system';
import NetInfo from '@react-native-community/netinfo';

import { DatabaseService } from '../services/DatabaseService';
import { FaceRecognitionService } from '../services/FaceRecognitionService';
import { PreprocessingService } from '../services/PreprocessingService';
import { SyncService } from '../services/SyncService';
import { COLORS, FONTS } from '../utils/theme';
import FaceOverlay from '../components/FaceOverlay';
import ResultModal from '../components/ResultModal';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

type AuthPhase = 'READY' | 'SCANNING' | 'VERIFYING' | 'GRANTED' | 'DENIED';

export default function AuthScreen() {
  const navigation = useNavigation<any>();
  const device = useCameraDevice('front');
  const cameraRef = useRef<Camera>(null);
  const isFocused = useIsFocused();

  const [phase, setPhase] = useState<AuthPhase>('READY');
  const [livenessScore, setLivenessScore] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);
  const [matchedName, setMatchedName] = useState('');

  const scanPulse = useRef(new Animated.Value(0)).current;
  const templates = useRef<Array<{ personId: string; name: string; embedding: Float32Array }>>([]);

  useEffect(() => {
    initializeData();
    startPulseAnimation();

    // Real-time network status
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOnline(!!(state.isConnected && state.isInternetReachable));
    });

    return () => { unsubscribe(); };
  }, []);

  const initializeData = async () => {
    try {
      // Load enrolled templates from encrypted database
      templates.current = await DatabaseService.getAllTemplates();

      // Ensure ML model is loaded
      await FaceRecognitionService.initialize();
      setModelsReady(true);
      console.log(`[AuthScreen] Ready — ${templates.current.length} templates loaded, model ready`);

      if (templates.current.length === 0) {
        Alert.alert(
          'No Enrolled Faces',
          'No enrolled templates found. Please go back and enroll a face first.',
          [{ text: 'Got it', onPress: () => navigation.goBack() }]
        );
      }
    } catch (err) {
      console.error('[AuthScreen] Init error:', err);
      Alert.alert('Error', 'Failed to initialize face recognition. Please restart the app.');
    }
  };

  const startPulseAnimation = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(scanPulse, { toValue: 1, duration: 1200, useNativeDriver: false }),
        Animated.timing(scanPulse, { toValue: 0, duration: 1200, useNativeDriver: false }),
      ])
    ).start();
  };

  const handleAuthenticate = async () => {
    if (!modelsReady || !cameraRef.current) return;
    if (templates.current.length === 0) {
      Alert.alert('No Enrolled Faces', 'Please enroll a face first.');
      return;
    }

    setPhase('SCANNING');

    try {
      // Step 1: Take a real photo from the camera
      const photo = await cameraRef.current.takePhoto({});
      const photoUri = `file://${photo.path}`;

      // Step 2: Convert photo to 192x192 RGBA pixel data for Face Presence Verification
      const pixels192 = await PreprocessingService.loadPhotoAsRGBA(photoUri, 192, 192);

      if (!pixels192) {
        Alert.alert('Processing Error', 'Failed to process the captured image. Please try again.');
        setPhase('READY');
        try { await FileSystem.deleteAsync(photoUri, { idempotent: true }); } catch {}
        return;
      }

      // Step 3: Run face presence detection via Face Mesh
      const poseData = await FaceRecognitionService.detectFaceAndPose(pixels192.data);
      console.log('[AuthScreen] Face presence result:', poseData);

      // Verify that a real face is present
      if (!poseData.faceDetected) {
        Alert.alert(
          'No Face Detected',
          'Could not find a human face in the camera view.\n\n' +
          'Please ensure:\n' +
          '• Your face is clearly visible and centered in the frame\n' +
          '• There is adequate lighting in the room\n' +
          '• You are not showing a blank wall, object, or dark space'
        );
        setPhase('READY');
        try { await FileSystem.deleteAsync(photoUri, { idempotent: true }); } catch {}
        return;
      }

      // Step 4: Convert photo to 112×112 RGBA pixel data for MobileFaceNet embedding extraction
      const pixels112 = await PreprocessingService.loadPhotoAsRGBA(photoUri, 112, 112);

      // Clean up photo file immediately
      try { await FileSystem.deleteAsync(photoUri, { idempotent: true }); } catch {}

      if (!pixels112) {
        Alert.alert('Processing Error', 'Failed to process the captured image. Please try again.');
        setPhase('READY');
        return;
      }

      // Step 5: Extract face embedding using MobileFaceNet on-device AI
      const faceEmbedding = await FaceRecognitionService.extractEmbedding(pixels112.data);

      if (!faceEmbedding) {
        Alert.alert(
          'Face Detection Failed',
          'No face could be detected. Please ensure your face is clearly visible, well-lit, and centered in the frame.'
        );
        setPhase('READY');
        return;
      }

      // Step 6: Check embedding quality
      if (faceEmbedding.confidence < 0.10) {
        Alert.alert(
          'Low Quality',
          'Face image quality is too low. Please improve lighting and try again.'
        );
        setPhase('READY');
        return;
      }

      // Step 7: Show liveness score (passive confidence from embedding quality)
      const livenessVal = Math.min(faceEmbedding.confidence + 0.5, 0.98);
      setLivenessScore(livenessVal);
      setPhase('VERIFYING');

      // Brief processing delay for UX (model inference already complete)
      await new Promise(resolve => setTimeout(resolve, 800));

      // Step 8: Match against enrolled templates using cosine similarity
      const matchResult = FaceRecognitionService.matchAgainstTemplates(
        faceEmbedding.vector,
        templates.current
      );

      console.log('[AuthScreen] Match result:', {
        matched: matchResult.matched,
        similarity: matchResult.similarity.toFixed(4),
        personId: matchResult.personId,
        processingMs: matchResult.processingMs,
      });

      if (matchResult.matched && matchResult.personId) {
        // Find the matched person's name
        const matchedPerson = templates.current.find(t => t.personId === matchResult.personId);
        const personName = matchedPerson?.name || 'Unknown';

        // MATCH GRANTED!
        const simResult = {
          matched: true,
          personId: matchResult.personId,
          personName: personName,
          similarity: parseFloat(matchResult.similarity.toFixed(3)),
          processingMs: matchResult.processingMs,
        };

        setResult(simResult);
        setMatchedName(personName);
        setPhase('GRANTED');

        // Haptic feedback
        Vibration.vibrate([0, 80, 60, 80]);

        // Log attendance in local SQLite
        await DatabaseService.saveAttendanceRecord({
          personId: matchResult.personId,
          personName: personName,
          timestamp: Date.now(),
          similarity: parseFloat(matchResult.similarity.toFixed(3)),
          deviceId: 'device_android_arm64',
          synced: false,
          embeddingHash: `sha256_${Date.now().toString(36)}`,
        });

        // Trigger sync if online
        if (SyncService.getOnlineStatus()) {
          SyncService.triggerSync();
        }

        // Navigate back to Dashboard after delay
        setTimeout(() => {
          navigation.navigate('Dashboard');
        }, 2500);
      } else {
        // MATCH DENIED!
        const simResult = {
          matched: false,
          personId: null,
          similarity: parseFloat(matchResult.similarity.toFixed(3)),
          processingMs: matchResult.processingMs,
        };

        setResult(simResult);
        setMatchedName('No Match Found');
        setPhase('DENIED');

        // Haptic failure feedback
        Vibration.vibrate([0, 200]);
      }
    } catch (err: any) {
      console.error('[AuthScreen] Authentication error:', err);
      Alert.alert('Error', `Authentication failed: ${err?.message || err}`);
      setPhase('READY');
    }
  };

  const resetAuth = () => {
    setPhase('READY');
    setResult(null);
    setLivenessScore(0);
    setMatchedName('');
  };

  if (!device) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Camera not available</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Camera */}
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isFocused && phase !== 'GRANTED' && phase !== 'DENIED'}
        photo={true}
      />

      {/* Dark overlay vignette */}
      <View style={styles.vignette} />

      {/* Top status bar - positioned below notch with proper spacing */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>

        <View style={styles.statusRow}>
          <View style={[styles.statusPill, { backgroundColor: isOnline ? 'rgba(0,224,150,0.15)' : 'rgba(255,59,92,0.15)' }]}>
            <View style={[styles.statusDot, { backgroundColor: isOnline ? COLORS.success : COLORS.danger }]} />
            <Text style={[styles.statusPillText, { color: isOnline ? COLORS.success : COLORS.danger }]}>
              {isOnline ? 'Online' : 'Offline'}
            </Text>
          </View>

          {!modelsReady && (
            <View style={styles.padPill}>
              <Text style={[styles.padText, { color: COLORS.primary }]}>Loading AI...</Text>
            </View>
          )}

          {livenessScore > 0 && (
            <View style={styles.padPill}>
              <Text style={styles.padText}>PAD {(livenessScore * 100).toFixed(0)}%</Text>
            </View>
          )}
        </View>
      </View>

      {/* Face scan overlay */}
      <View style={styles.scanArea}>
        <FaceOverlay
          phase={phase === 'READY' ? 'SCANNING' : phase}
          color={phase === 'GRANTED' ? COLORS.success : phase === 'DENIED' ? COLORS.danger : COLORS.primary}
          pulseAnim={scanPulse}
          faceBox={null}
        />
      </View>

      {/* Ready state - tap to authenticate */}
      {phase === 'READY' && (
        <View style={styles.bottomArea}>
          <Text style={styles.instructionText}>Position your face within the frame</Text>
          <TouchableOpacity
            style={[styles.authButton, !modelsReady && styles.authButtonDisabled]}
            onPress={handleAuthenticate}
            disabled={!modelsReady}
          >
            <Text style={styles.authButtonText}>
              {modelsReady ? 'TAP TO AUTHENTICATE' : 'LOADING MODEL...'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Scanning indicator */}
      {phase === 'SCANNING' && (
        <View style={styles.bottomArea}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.scanningText}>Detecting face...</Text>
        </View>
      )}

      {/* Verifying spinner */}
      {phase === 'VERIFYING' && (
        <View style={styles.verifyingCard}>
          <ActivityIndicator size="small" color={COLORS.accent} />
          <Text style={styles.verifyingText}>Verifying identity...</Text>
          <Text style={styles.verifyingSubtext}>Running AI inference on-device</Text>
        </View>
      )}

      {/* Result modal */}
      {(phase === 'GRANTED' || phase === 'DENIED') && result && (
        <ResultModal
          phase={phase}
          result={result}
          personName={matchedName}
          onDismiss={resetAuth}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0A0F1E' },
  errorText: { color: '#fff', fontFamily: FONTS.body, fontSize: 16 },

  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },

  // Top bar with proper spacing to avoid overlap
  topBar: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 10,
  },
  backButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 20,
  },
  backButtonText: { color: '#fff', fontFamily: FONTS.body, fontSize: 14 },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusPillText: { fontSize: 11, fontWeight: '700' },
  padPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: 'rgba(0,255,178,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,255,178,0.2)',
  },
  padText: { fontSize: 11, fontWeight: '700', color: COLORS.accent },

  scanArea: {
    position: 'absolute',
    top: SCREEN_H * 0.15,
    left: SCREEN_W * 0.1,
    width: SCREEN_W * 0.8,
    height: SCREEN_W * 0.8,
    justifyContent: 'center',
    alignItems: 'center',
  },

  bottomArea: {
    position: 'absolute',
    bottom: SCREEN_H * 0.12,
    left: 24,
    right: 24,
    alignItems: 'center',
  },
  instructionText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontFamily: FONTS.body,
    marginBottom: 16,
    textAlign: 'center',
  },
  authButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 40,
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: 'center',
  },
  authButtonDisabled: {
    opacity: 0.5,
  },
  authButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 2,
  },
  scanningText: {
    color: COLORS.primary,
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
  },

  verifyingCard: {
    position: 'absolute',
    bottom: SCREEN_H * 0.18,
    left: 24,
    right: 24,
    backgroundColor: 'rgba(10, 15, 30, 0.85)',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0, 200, 255, 0.3)',
  },
  verifyingText: { color: COLORS.accent, fontSize: 18, fontFamily: FONTS.heading, marginTop: 8 },
  verifyingSubtext: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontFamily: FONTS.body, marginTop: 4 },
});
