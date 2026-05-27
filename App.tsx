import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';

import SplashScreen from './src/screens/SplashScreen';
import HomeScreen from './src/screens/HomeScreen';
import AuthScreen from './src/screens/AuthScreen';
import EnrollScreen from './src/screens/EnrollScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import SyncScreen from './src/screens/SyncScreen';

import { DatabaseService } from './src/services/DatabaseService';
import { FaceRecognitionService } from './src/services/FaceRecognitionService';
import { SyncService } from './src/services/SyncService';

const Stack = createStackNavigator();

export default function App() {
  useEffect(() => {
    const initApp = async () => {
      try {
        await DatabaseService.initialize();
        // Start ML model loading early (non-blocking)
        FaceRecognitionService.initialize().catch(err => {
          console.warn('[App] FaceRecognition model pre-load failed (will retry in screens):', err);
        });
        SyncService.startNetworkListener();
      } catch (error) {
        console.error('[App] Initialization failed:', error);
      }
    };
    initApp();
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <NavigationContainer>
        <StatusBar style="light" />
        <Stack.Navigator
          initialRouteName="Splash"
          screenOptions={{ 
            headerShown: false, 
            cardStyleInterpolator: ({ current }) => ({
              cardStyle: { opacity: current.progress }
            })
          }}
        >
          <Stack.Screen name="Splash" component={SplashScreen} />
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Auth" component={AuthScreen} />
          <Stack.Screen name="Enroll" component={EnrollScreen} />
          <Stack.Screen name="Dashboard" component={DashboardScreen} />
          <Stack.Screen name="Sync" component={SyncScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
