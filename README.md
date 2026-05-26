# 🏆 DataLake FaceID — Offline Biometric Attendance System
### NHAI Hackathon 7.0 Submission
> **A secure, lightweight, and fully offline facial recognition & passive liveness detection system built for remote, zero-network environments.**

---

## 📌 Project Overview
**DataLake FaceID** is a production-grade, offline-first biometric authentication application designed for NHAI (National Highways Authority of India) field personnel. In high-altitude mountain tunnels, remote highway stretches, and zero-connectivity highway construction corridors, traditional cloud-reliant biometric systems fail completely. 

This system moves **100% of the AI processing pipeline directly onto standard, low-cost Android and iOS mobile devices**. It achieves extreme speed, bank-grade biometric security, and absolute privacy compliance by running localized deep learning inference entirely offline.

### 🌟 Key Core Innovations
*   **Fully Offline Operation:** No internet? No problem. Face alignment, passive/active liveness detection, model inference, and feature matching happen entirely in airplane mode.
*   **Ultra-Lightweight (~12MB total):** Runs three state-of-the-art quantized INT8 neural networks locally, taking up less than 13MB of total storage—well under the 20MB hackathon limit.
*   **Robust to Indian Weather & Lighting:** Integrated **CLAHE (Contrast Limited Adaptive Histogram Equalization)** preprocessing tiles local contrast, correcting for harsh direct overhead sun, deep underpass shadows, and low-light highway toll plazas.
*   **Privacy-First (DPDP & GDPR Compliant):** **Zero raw face photos are ever stored** on the device or synced to the cloud. Raw camera feeds are immediately processed, converted to a highly secure 128-dimensional float embedding, and discarded.
*   **Intelligent Sync Queue:** Attendance logs are securely saved into a local SQLite database encrypted with **AES-256-GCM** (keys stored in the system secure hardware Keystore). The moment the device detects cellular coverage, it uploads data back to the cloud using idempotent upload tokens.

---

## 🛠️ System Architecture

```
                       [ Camera Frame (60 FPS RGBA) ]
                                      │
                                      ▼
                        [ PreprocessingService ]
                          ├─ CLAHE (Overhead Sun/Shadow Correction)
                          ├─ Face Cropping & Landmark Alignment
                          └─ Float32 Normalization [-1.0, 1.0]
                                      │
                       ┌──────────────┴──────────────┐
                       ▼                             ▼
              [ Liveness Engine ]           [ FaceRecognitionService ]
             MiniXception PAD INT8             MobileFaceNet INT8
           (Continuous Anti-Spoofing)          (128-d Feature Vector)
                       │                             │
                       └──────────────┬──────────────┘
                                      ▼
                             [ Decision Engine ]
                   (Matches Cosine Similarity Score >= 0.82)
                                      │
                              ┌───────┴───────┐
                              ▼               ▼
                         [ GRANTED ]     [ DENIED ]
                              │
                              ▼
               [ Encrypted SQLite Database (AES-256) ]
               (Secure Local Queue with Idempotent Tokens)
                              │
                    (On Internet Restored)
                              ▼
                [ Supabase Cloud Sync (PostgreSQL) ]
                 (Zero-duplicate central database)
```

---

## 📊 Deep Learning Model Pipeline
We selected and quantized highly optimized model architectures tailored for edge-computing mobile processors:

| Model | Task | Base Architecture | Quantized Size | Target Accuracy |
| :--- | :--- | :--- | :--- | :--- |
| **Landmark Detector** | 5-point face alignment & tracking | MediaPipe Face Mesh | **~3 MB** | 468 landmark points |
| **Liveness Check** | Passive Photo/Screen Spoof Prevention | MiniXception PAD | **~4 MB** | >96.4% on NUAA |
| **Face Recognition** | Embedding extraction & match verification | MobileFaceNet INT8 | **~5 MB** | >99.3% on LFW |
| **Total Pipeline** | **Complete Local Biometrics Suite** | | **~12 MB** | **Sub-50ms inference** |

---

## ⚙️ How to Run locally on Your System

Follow these simple steps to run this React Native/Expo project on your machine with fully functional local and cloud sync pipelines.

### 📋 Prerequisites
Ensure you have the following installed on your machine:
*   [Node.js](https://nodejs.org/) (Version 18 or higher)
*   [Android Studio](https://developer.android.com/studio) (for Android Emulator & SDK platform tools)
*   [Java Development Kit (JDK)](https://adoptium.net/) (Version 17 recommended for Gradle builds)
*   A physical Android device connected via USB (with **USB Debugging** enabled in Developer Options) for live camera testing.

---

### 🚀 Step-by-Step Installation

#### 1. Clone & Install Dependencies
First, navigate into the project directory and install the necessary npm packages:
```bash
# Navigate to project folder
cd datalake-faceid

# Install packages
npm install
```

#### 2. Configure the TFLite Models
Because neural network weights are large binary files, they are placed locally inside the asset bundle:
1. Create a directory named `models` inside the assets folder: `assets/models/`
2. Place the three model files inside `assets/models/`:
   *   `mobilefacenet_int8.tflite`
   *   `minixception_pad_int8.tflite`
   *   `mediapipe_face_mesh.tflite`

*(Note: Download links to open-source pre-trained model files are provided in [scripts/download_models.txt](file:///d:/Projects/datalake-faceid/scripts/download_models.txt).)*

#### 3. Create & Configure Supabase Cloud Backend (Free)
1. Go to **[supabase.com](https://supabase.com)** and create a free project.
2. Open your Supabase **SQL Editor** (left sidebar), click **New Query**, paste the contents of `scripts/supabase_setup.sql`, and click **Run**. This automatically creates the `attendance_records` database table with idempotent indexing and Row Level Security.
3. Open **Settings → API** in your Supabase dashboard and copy the **Project URL** and **anon public key**.
4. In the root of your project folder, edit the **`.env`** file and paste your credentials:
```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-long-anon-jwt-token
```

#### 4. Run the Metro Bundler
Start the development server with cleared caches:
```bash
npx expo start --dev-client --clear
```

#### 5. Compile and Install on Your Device/Emulator
With your physical device plugged in (or emulator running), compile the app:
```bash
# Build & Run on Android
npx expo run:android

# Build & Run on iOS
npx expo run:ios
```

To compile a final **production-ready release APK** that runs entirely standalone on a phone without needing a USB cable or a computer:
```bash
npx expo run:android --variant release
```

---

## 🔒 Security Design

| Security Layer | Technical Implementation |
| :--- | :--- |
| **Biometric Privacy** | Raw camera images are immediately parsed in memory, mapped to a 128-float coordinate array, and discarded. Raw face photos never touch the disk. |
| **Local Encryption** | SQLite database is fully encrypted utilizing **AES-256-GCM** authenticated encryption. |
| **Secure Key Store** | Encryption keys are securely managed inside the native **Android Keystore** and **iOS Secure Enclave**, locked to the physical device. |
| **Deduplication** | Sync uploads include an idempotent `upload_token` based on embedding hashes, guaranteeing zero duplicate logs on network failures. |
| **Transit Security** | All background sync communication to Supabase is piped over strict **TLS 1.3** HTTPS connections. |

---

## 📂 Key Project Structure

```
datalake-faceid/
├── App.tsx                         ← React Navigation router
├── app.json                        ← Expo system config & permissions
├── package.json                    ← Project dependencies
├── .env                            ← Cloud sync credentials (gitignored)
├── scripts/
│   └── supabase_setup.sql          ← Supabase SQL database schema setup
├── assets/
│   └── models/                     ← Quantized TFLite models
└── src/
    ├── screens/
    │   ├── SplashScreen.tsx        ← Animated cyberpunk boot screen
    │   ├── HomeScreen.tsx          ← Dashboard hub showing local stats
    │   ├── AuthScreen.tsx          ← Local camera face recognition + liveness
    │   ├── EnrollScreen.tsx        ← 5-angle guided biometric enrollment
    │   ├── DashboardScreen.tsx     ← SQLite attendance log table
    │   └── SyncScreen.tsx          ← Cloud sync panel and manual controls
    ├── services/
    │   ├── PreprocessingService.ts  ← CLAHE lighting correction & cropping
    │   ├── DatabaseService.ts         ← AES-256-GCM Encrypted SQLite storage
    │   ├── SupabaseClient.ts          ← Supabase connection client
    │   └── SyncService.ts             ← Idempotent background sync queue
    ├── components/
    │   ├── FaceOverlay.tsx            ← Animated face alignment HUD
    │   └── ResultModal.tsx            ← Authentication status overlay
    └── utils/
        └── theme.ts                   ← Sleek dark mode design tokens
```

---

*DataLake FaceID — Developed for NHAI Hackathon 7.0. Built entirely using high-performance, open-source technologies.*
