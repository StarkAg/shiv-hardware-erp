plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "in.shivhardware.counter"
    compileSdk = 35

    defaultConfig {
        applicationId = "in.shivhardware.counter"
        minSdk = 26
        targetSdk = 35
        // Raise both with every build given to the phones, or Android will not
        // install it over the last one.
        versionCode = 3
        versionName = "1.2"
    }

    // One fixed key, so each new build installs over the last. Its file and password
    // are given by the build (GitHub secrets, see .github/workflows/build-shiv-counter.yml)
    // and kept outside git. Without them the build is signed with a throwaway debug key.
    val keystore = System.getenv("SHIV_COUNTER_KEYSTORE")
    signingConfigs {
        if (keystore != null) {
            create("shop") {
                storeFile = file(keystore)
                storePassword = System.getenv("SHIV_COUNTER_KEYSTORE_PASSWORD")
                keyAlias = "shiv-counter"
                keyPassword = System.getenv("SHIV_COUNTER_KEYSTORE_PASSWORD")
            }
        }
    }
    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = if (keystore != null) signingConfigs.getByName("shop") else signingConfigs.getByName("debug")
        }
    }

    // MainActivity puts the version in the user agent ("ShivCounterApp/1.0").
    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    // Only the Android SDK itself: the app is a frame round the Counter website.
    implementation("androidx.core:core-ktx:1.13.1")
}
