import React from 'react';
import { StyleSheet, View, Animated } from 'react-native';

interface Props {
  phase: string;
  color: string;
  pulseAnim: Animated.Value;
  faceBox?: { x: number; y: number; size: number } | null;
}

export default function FaceOverlay({ phase, color, pulseAnim }: Props) {
  const cornerStyle = { borderColor: color };

  return (
    <View style={styles.container}>
      {/* Animated rings */}
      <Animated.View
        style={[
          styles.ring,
          {
            borderColor: color,
            opacity: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.25] }),
            transform: [
              { scale: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] }) }
            ],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.ringInner,
          {
            borderColor: color,
            opacity: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.35] }),
          },
        ]}
      />

      {/* Corner brackets */}
      <View style={styles.corners}>
        <View style={[styles.corner, styles.cornerTL, cornerStyle]} />
        <View style={[styles.corner, styles.cornerTR, cornerStyle]} />
        <View style={[styles.corner, styles.cornerBL, cornerStyle]} />
        <View style={[styles.corner, styles.cornerBR, cornerStyle]} />
      </View>

      {/* Scan line — only visible in scanning/liveness phase */}
      {(phase === 'SCANNING' || phase === 'LIVENESS') && (
        <Animated.View
          style={[
            styles.scanLine,
            {
              backgroundColor: color,
              top: pulseAnim.interpolate({
                inputRange: [0, 1],
                outputRange: ['10%', '90%'],
              }),
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },

  ring: {
    position: 'absolute',
    width: '100%', height: '100%',
    borderRadius: 999, borderWidth: 1,
  },
  ringInner: {
    position: 'absolute',
    width: '85%', height: '85%',
    borderRadius: 999, borderWidth: 1,
  },

  corners: { position: 'absolute', width: '95%', height: '95%' },

  corner: { position: 'absolute', width: 28, height: 28, borderStyle: 'solid' },
  cornerTL: { top: 0, left: 0,     borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 6 },
  cornerTR: { top: 0, right: 0,    borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 6 },
  cornerBL: { bottom: 0, left: 0,  borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 6 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 6 },

  scanLine: {
    position: 'absolute',
    left: '5%', right: '5%',
    height: 2, borderRadius: 1,
    opacity: 0.7,
  },
});
