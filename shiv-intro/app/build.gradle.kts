plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "in.shivhardware.intro"
    compileSdk = 35

    defaultConfig {
        applicationId = "in.shivhardware.intro"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "1.1"
        // The Samsung is 64-bit, and Convex's client carries a native library per chip.
        ndk { abiFilters += "arm64-v8a" }
    }

    // One fixed key, so each new build installs over the last. Its file and passwords
    // are given by the build (GitHub secrets, see .github/workflows/build-shiv-intro.yml)
    // and kept outside git. Without them the build is signed with a throwaway debug key.
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

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    // BuildConfig.VERSION_NAME goes in the page's user agent (MainActivity).
    buildFeatures { buildConfig = true }
}

dependencies {
    implementation("dev.convex:android-convexmobile:0.8.0@aar") { isTransitive = true }
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
