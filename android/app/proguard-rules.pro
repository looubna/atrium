# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ── Atrium release (R8 on for Play's deobfuscation map; behaviour must not change) ──
# Optional sign-in providers the Firebase Authentication plugin can use but Atrium does not ship.
-dontwarn com.facebook.**
# Keep everything the WebView reaches by name exactly as written: our code, Capacitor, its plugins
# (bridged by reflection), RevenueCat and Firebase. R8 still shrinks unused library code around them.
-keep class com.atriumcoach.app.** { *; }
-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.** { *; }
-keep class io.capawesome.** { *; }
-keep class com.revenuecat.** { *; }
-keep class com.google.firebase.** { *; }
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod, SourceFile, LineNumberTable
