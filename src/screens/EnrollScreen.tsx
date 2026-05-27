import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity,
  TextInput, ScrollView, Animated, Alert, ActivityIndicator,
} from 'react-native';
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system';
import { DatabaseService } from '../services/DatabaseService';
import { FaceRecognitionService } from '../services/FaceRecognitionService';
import { PreprocessingService } from '../services/PreprocessingService';
import { COLORS, FONTS, SPACING, RADIUS } from '../utils/theme';

type EnrollPhase = 'FORM' | 'CAPTURE' | 'PROCESSING' | 'DONE' | 'ERROR';

const CAPTURE_ANGLES = ['Front', 'Slight Left', 'Slight Right', 'Look Up', 'Look Down'];

export default function EnrollScreen() {
  const navigation = useNavigation<any>();
  const device = useCameraDevice('front');
  const cameraRef = useRef<Camera>(null);
  const isFocused = useIsFocused();

  const [phase, setPhase] = useState<EnrollPhase>('FORM');
  const [name, setName] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [capturedCount, setCapturedCount] = useState(0);
  const [currentAngle, setCurrentAngle] = useState(0);
  const [qualityScore, setQualityScore] = useState(0);
  const [embeddings, setEmbeddings] = useState<Float32Array[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [modelsReady, setModelsReady] = useState(false);

  const progressAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    initializeModels();
  }, []);

  const initializeModels = async () => {
    try {
      await FaceRecognitionService.initialize();
      setModelsReady(true);
      console.log('[EnrollScreen] ML models ready');
    } catch (err) {
      console.error('[EnrollScreen] Model initialization failed:', err);
      Alert.alert(
        'Model Error',
        'Failed to load face recognition model. Please restart the app.',
        [{ text: 'Go Back', onPress: () => navigation.goBack() }]
      );
    }
  };

  const handleStartCapture = () => {
    if (!name.trim() || !employeeCode.trim()) {
      Alert.alert('Missing Info', 'Please enter name and employee code.');
      return;
    }
    if (!modelsReady) {
      Alert.alert('Loading', 'Face recognition model is still loading. Please wait a moment.');
      return;
    }
    setPhase('CAPTURE');
    setCapturedCount(0);
    setCurrentAngle(0);
    setEmbeddings([]);
  };

  const handleCapture = async () => {
    if (isProcessing) return; // Prevent double-tap
    setIsProcessing(true);
    setStatusText('Capturing...');

    try {
      // Step 1: Take a REAL photo from the camera
      if (!cameraRef.current) {
        Alert.alert('Camera Error', 'Camera is not ready. Please wait a moment.');
        setIsProcessing(false);
        setStatusText('');
        return;
      }

      const photo = await cameraRef.current.takePhoto({});
      const photoUri = `file://${photo.path}`;

      // Step 2: Convert photo to 192x192 RGBA pixel data for Face Presence & Pose Detection
      setStatusText('Detecting face...');
      const pixels192 = await PreprocessingService.loadPhotoAsRGBA(photoUri, 192, 192);

      if (!pixels192) {
        Alert.alert('Processing Error', 'Failed to process the captured image. Please try again.');
        setIsProcessing(false);
        setStatusText('');
        try { await FileSystem.deleteAsync(photoUri, { idempotent: true }); } catch {}
        return;
      }

      // Step 3: Run face presence and pose estimation via Face Mesh
      const poseData = await FaceRecognitionService.detectFaceAndPose(pixels192.data);
      console.log('[EnrollScreen] Face detection and pose result:', poseData);

      // Verify that a real face is present
      if (!poseData.faceDetected) {
        Alert.alert(
          'No Face Detected',
          'Could not find a human face in the camera view.\n\n' +
          'Please ensure:\n' +
          '• You are holding the camera directly in front of your face\n' +
          '• There is good, even lighting (no dark shadows or harsh backlights)\n' +
          '• You are not showing an empty room, wall, or object'
        );
        setIsProcessing(false);
        setStatusText('');
        try { await FileSystem.deleteAsync(photoUri, { idempotent: true }); } catch {}
        return;
      }

      // Verify that the face pose matches the requested angle
      const expectedAngle = CAPTURE_ANGLES[currentAngle]; // 'Front' | 'Slight Left' | 'Slight Right' | 'Look Up' | 'Look Down'
      let poseMatches = false;
      let incorrectMsg = '';

      if (expectedAngle === 'Front') {
        // Enforce straight head pose
        if (Math.abs(poseData.yaw) < 0.08 && Math.abs(poseData.pitch) < 0.08) {
          poseMatches = true;
        } else {
          incorrectMsg = 'Please look directly straight at the camera lens.';
        }
      } else if (expectedAngle === 'Slight Left') {
        // Enforce turned left (support horizontal turn magnitude to avoid mirroring frustration)
        if (Math.abs(poseData.yaw) > 0.08) {
          poseMatches = true;
        } else {
          incorrectMsg = 'Please turn your head slightly to the left.';
        }
      } else if (expectedAngle === 'Slight Right') {
        if (Math.abs(poseData.yaw) > 0.08) {
          poseMatches = true;
        } else {
          incorrectMsg = 'Please turn your head slightly to the right.';
        }
      } else if (expectedAngle === 'Look Up') {
        if (Math.abs(poseData.pitch) > 0.08) {
          poseMatches = true;
        } else {
          incorrectMsg = 'Please tilt your head slightly upwards.';
        }
      } else if (expectedAngle === 'Look Down') {
        if (Math.abs(poseData.pitch) > 0.08) {
          poseMatches = true;
        } else {
          incorrectMsg = 'Please tilt your head slightly downwards.';
        }
      }

      if (!poseMatches) {
        Alert.alert(
          'Incorrect Angle',
          `The camera detected you are not looking in the correct direction.\n\n` +
          `Requested: ${expectedAngle}\n` +
          `${incorrectMsg}`
        );
        setIsProcessing(false);
        setStatusText('');
        try { await FileSystem.deleteAsync(photoUri, { idempotent: true }); } catch {}
        return;
      }

      // Step 4: Convert photo to 112×112 RGBA pixel data for MobileFaceNet embedding extraction
      setStatusText('Extracting biometric features...');
      const pixels112 = await PreprocessingService.loadPhotoAsRGBA(photoUri, 112, 112);
      
      // Clean up original photo file immediately
      try { await FileSystem.deleteAsync(photoUri, { idempotent: true }); } catch {}

      if (!pixels112) {
        Alert.alert('Processing Error', 'Failed to extract face embedding. Please try again.');
        setIsProcessing(false);
        setStatusText('');
        return;
      }

      // Step 5: Extract embedding
      const faceEmbedding = await FaceRecognitionService.extractEmbedding(pixels112.data);

      if (!faceEmbedding) {
        Alert.alert(
          'Embedding Error',
          'Failed to extract biometric features. Please try again under better lighting.'
        );
        setIsProcessing(false);
        setStatusText('');
        return;
      }

      // Step 6: Validate embedding quality
      if (faceEmbedding.confidence < 0.10) {
        Alert.alert(
          'Low Quality Image',
          'The captured image quality is too low. Please improve lighting or adjust your position.'
        );
        setIsProcessing(false);
        setStatusText('');
        return;
      }

      // ✓ Success! Face detected, pose matched, and embedding extracted
      setQualityScore(faceEmbedding.confidence);
      setStatusText('Face captured ✓');

      const newEmbeddings = [...embeddings, faceEmbedding.vector];
      setEmbeddings(newEmbeddings);

      const newCount = capturedCount + 1;
      setCapturedCount(newCount);

      // Animate progress bar
      Animated.timing(progressAnim, {
        toValue: newCount / CAPTURE_ANGLES.length,
        duration: 300,
        useNativeDriver: false,
      }).start();

      if (newCount < CAPTURE_ANGLES.length) {
        setCurrentAngle(newCount);
        setTimeout(() => {
          setStatusText('');
          setIsProcessing(false);
        }, 600);
      } else {
        // All angles captured — finalize enrollment
        await finalizeEnrollment(newEmbeddings);
        setIsProcessing(false);
        setStatusText('');
      }
    } catch (err: any) {
      console.error('[EnrollScreen] handleCapture error:', err);
      Alert.alert('Capture Error', `${err?.message || err}`);
      setIsProcessing(false);
      setStatusText('');
    }
  };

  const finalizeEnrollment = async (allEmbeddings: Float32Array[]) => {
    setPhase('PROCESSING');

    // Compute mean embedding (average of all captured angles)
    const dim = allEmbeddings[0].length;
    const mean = new Float32Array(dim);
    for (const emb of allEmbeddings) {
      for (let i = 0; i < dim; i++) mean[i] += emb[i];
    }
    for (let i = 0; i < dim; i++) mean[i] /= allEmbeddings.length;

    // L2 normalize mean
    let norm = 0;
    for (const v of mean) norm += v * v;
    norm = Math.sqrt(norm);
    const normalized = mean.map(v => v / norm);

    // Save to encrypted database
    const personId = `person_${Date.now()}`;
    await DatabaseService.savePersonTemplate(personId, name.trim(), employeeCode.trim(), normalized);

    setPhase('DONE');
  };

  const resetEnroll = () => {
    setPhase('FORM');
    setName('');
    setEmployeeCode('');
    setCapturedCount(0);
    setCurrentAngle(0);
    setEmbeddings([]);
    setQualityScore(0);
    setStatusText('');
    progressAnim.setValue(0);
  };

  if (!device && phase === 'CAPTURE') {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Camera not available</Text>
      </View>
    );
  }

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Enroll Person</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── FORM phase ── */}
        {phase === 'FORM' && (
          <View>
            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>Enrollment Process</Text>
              <Text style={styles.infoText}>
                5 frames are captured at different angles. A mean embedding is computed
                and stored as an AES-256 encrypted template — no raw images saved.
              </Text>
              {!modelsReady && (
                <View style={styles.modelLoadingRow}>
                  <ActivityIndicator size="small" color={COLORS.primary} />
                  <Text style={styles.modelLoadingText}>Loading AI model...</Text>
                </View>
              )}
              {modelsReady && (
                <View style={styles.modelLoadingRow}>
                  <Text style={styles.modelReadyText}>✓ AI model ready</Text>
                </View>
              )}
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Full Name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Rahul Kumar"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="words"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Employee Code</Text>
              <TextInput
                style={styles.input}
                value={employeeCode}
                onChangeText={setEmployeeCode}
                placeholder="e.g. EMP-2042"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="characters"
              />
            </View>

            <View style={styles.anglesPreview}>
              <Text style={styles.fieldLabel}>Capture Angles</Text>
              <View style={styles.angleChips}>
                {CAPTURE_ANGLES.map((angle, i) => (
                  <View key={i} style={styles.angleChip}>
                    <Text style={styles.angleChipText}>{angle}</Text>
                  </View>
                ))}
              </View>
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, !modelsReady && styles.primaryBtnDisabled]}
              onPress={handleStartCapture}
              disabled={!modelsReady}
            >
              <Text style={styles.primaryBtnText}>
                {modelsReady ? 'START CAPTURE' : 'LOADING MODEL...'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── CAPTURE phase ── */}
        {phase === 'CAPTURE' && (
          <View>
            <View style={styles.cameraBox}>
              {device && (
                <Camera
                  ref={cameraRef}
                  style={StyleSheet.absoluteFill}
                  device={device}
                  isActive={isFocused}
                  photo={true}
                />
              )}
              <View style={styles.cameraOverlay}>
                <View style={styles.captureGuide}>
                  <View style={[styles.guideCorner, styles.guideTL]} />
                  <View style={[styles.guideCorner, styles.guideTR]} />
                  <View style={[styles.guideCorner, styles.guideBL]} />
                  <View style={[styles.guideCorner, styles.guideBR]} />
                </View>
              </View>
            </View>

            <View style={styles.captureInfo}>
              <Text style={styles.angleLabel}>
                {CAPTURE_ANGLES[currentAngle]}
              </Text>
              <Text style={styles.captureCount}>
                {capturedCount} / {CAPTURE_ANGLES.length} captured
              </Text>
            </View>

            {/* Progress */}
            <View style={styles.progressTrack}>
              <Animated.View
                style={[
                  styles.progressFill,
                  {
                    width: progressAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', '100%'],
                    }),
                  },
                ]}
              />
            </View>

            {/* Angle indicators */}
            <View style={styles.angleRow}>
              {CAPTURE_ANGLES.map((angle, i) => (
                <View
                  key={i}
                  style={[
                    styles.angleDot,
                    i < capturedCount && styles.angleDotDone,
                    i === currentAngle && styles.angleDotActive,
                  ]}
                />
              ))}
            </View>

            {/* Capture button or processing indicator */}
            {isProcessing ? (
              <View style={styles.processingContainer}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={styles.processingText}>{statusText}</Text>
              </View>
            ) : (
              <TouchableOpacity style={styles.captureBtn} onPress={handleCapture}>
                <View style={styles.captureBtnInner} />
              </TouchableOpacity>
            )}

            <Text style={styles.captureHint}>
              {statusText || `Position your face ${CAPTURE_ANGLES[currentAngle].toLowerCase()} and tap capture`}
            </Text>
          </View>
        )}

        {/* ── PROCESSING phase ── */}
        {phase === 'PROCESSING' && (
          <View style={styles.processingContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.processingText}>Computing biometric template...</Text>
            <Text style={styles.processingSubtext}>Encrypting with AES-256-GCM</Text>
          </View>
        )}

        {/* ── DONE phase ── */}
        {phase === 'DONE' && (
          <View style={styles.doneCard}>
            <View style={styles.doneIconCircle}>
              <Text style={styles.doneIcon}>✓</Text>
            </View>
            <Text style={styles.doneTitle}>Enrollment Complete</Text>
            <Text style={styles.doneText}>
              {name} has been enrolled with {CAPTURE_ANGLES.length} biometric captures.
              Template is encrypted and stored locally.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={resetEnroll}>
              <Text style={styles.primaryBtnText}>ENROLL ANOTHER</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: 'transparent', borderWidth: 1, borderColor: COLORS.primary, marginTop: SPACING.sm }]}
              onPress={() => navigation.goBack()}
            >
              <Text style={[styles.primaryBtnText, { color: COLORS.primary }]}>BACK TO HOME</Text>
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg, paddingTop: 56, paddingBottom: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn: { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: COLORS.surface, borderRadius: RADIUS.full },
  backBtnText: { color: COLORS.textSecondary, fontSize: 13 },
  title: { fontSize: 18, fontWeight: '700', color: COLORS.textPrimary, letterSpacing: 1 },

  content: { padding: SPACING.lg, paddingBottom: 80 },
  errorText: { color: '#fff', fontSize: 16, textAlign: 'center', marginTop: 100 },

  infoCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.lg,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.lg,
  },
  infoTitle: { fontSize: 16, fontWeight: '700', color: COLORS.primary, marginBottom: 8 },
  infoText: { fontSize: 13, color: COLORS.textSecondary, lineHeight: 20 },

  modelLoadingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 8 },
  modelLoadingText: { fontSize: 12, color: COLORS.primary, fontWeight: '600' },
  modelReadyText: { fontSize: 12, color: COLORS.success, fontWeight: '600' },

  field: { marginBottom: SPACING.md },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 },
  input: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.md,
    color: COLORS.textPrimary, fontSize: 15, borderWidth: 1, borderColor: COLORS.border,
  },

  anglesPreview: { marginBottom: SPACING.lg },
  angleChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  angleChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.full, backgroundColor: 'rgba(0,200,255,0.08)', borderWidth: 1, borderColor: 'rgba(0,200,255,0.2)' },
  angleChipText: { fontSize: 12, color: COLORS.primary, fontWeight: '600' },

  primaryBtn: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS.lg,
    paddingVertical: SPACING.md, alignItems: 'center', marginTop: SPACING.md,
  },
  primaryBtnDisabled: {
    backgroundColor: COLORS.border, opacity: 0.6,
  },
  primaryBtnText: { fontSize: 15, fontWeight: '800', color: '#000', letterSpacing: 2 },

  cameraBox: {
    width: '100%', aspectRatio: 1, borderRadius: RADIUS.lg,
    overflow: 'hidden', backgroundColor: '#000', marginBottom: SPACING.md,
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center', alignItems: 'center',
  },
  captureGuide: { width: '75%', aspectRatio: 1, position: 'relative' },
  guideCorner: { position: 'absolute', width: 24, height: 24, borderColor: COLORS.primary, borderWidth: 2.5 },
  guideTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  guideTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  guideBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  guideBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },

  captureInfo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm },
  angleLabel: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary },
  captureCount: { fontSize: 14, color: COLORS.primary, fontWeight: '600' },

  progressTrack: { height: 4, backgroundColor: COLORS.surface, borderRadius: 2, marginBottom: SPACING.md, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: COLORS.primary, borderRadius: 2 },

  angleRow: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: SPACING.lg },
  angleDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  angleDotDone: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  angleDotActive: { borderColor: COLORS.primary, borderWidth: 2 },

  captureBtn: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: COLORS.primary,
    justifyContent: 'center', alignItems: 'center', alignSelf: 'center', marginBottom: SPACING.sm,
  },
  captureBtnInner: { width: 52, height: 52, borderRadius: 26, backgroundColor: COLORS.primary },

  captureHint: { textAlign: 'center', fontSize: 12, color: COLORS.textMuted },

  processingContainer: { alignItems: 'center', paddingVertical: 60 },
  processingText: { color: COLORS.primary, fontSize: 16, fontWeight: '600', marginTop: 16 },
  processingSubtext: { color: COLORS.textMuted, fontSize: 12, marginTop: 4 },

  doneCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.xl,
    borderWidth: 1, borderColor: 'rgba(0,224,150,0.3)', alignItems: 'center',
  },
  doneIconCircle: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 2,
    borderColor: COLORS.success, justifyContent: 'center', alignItems: 'center', marginBottom: 16,
  },
  doneIcon: { fontSize: 32, color: COLORS.success },
  doneTitle: { fontSize: 20, fontWeight: '800', color: COLORS.success, letterSpacing: 1, marginBottom: 8 },
  doneText: { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: SPACING.md },
});
