plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "in.shivhardware.introcounter"
    compileSdk = 35

    defaultConfig {
        applicationId = "in.shivhardware.introcounter"
        minSdk = 26
        targetSdk = 35
        // Raise both with every build given to the phones, or Android will not
        // install it over the last one.
        versionCode = 1
        versionName = "1.0"
    }

    // Signed with the shop's Shiv_Intro key (same secrets as shiv-intro/), so each
    // build installs over the last. Without them the build uses a throwaway debug key.
    val keystore = System.getenv("SHIV_INTRO_KEYSTORE")
    signingConfigs {
        if (keystore != null) {
            create("shop") {
                storeFile = file(keystore)
                storePassword = System.getenv("SHIV_INTRO_KEYSTORE_PASSWORD")
                keyAlias = "shiv-intro"
                keyPassword = System.getenv("SHIV_INTRO_KEYSTORE_PASSWORD")
            }
        }
    }
    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = if (keystore != null) signingConfigs.getByName("shop") else signingConfigs.getByName("debug")
        }
    }

    // MainActivity puts the version in the user agent ("ShivIntroCounterApp/1.0").
    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

// Nothing beyond the Android SDK: the app is a frame round the Shiv Intro page.
