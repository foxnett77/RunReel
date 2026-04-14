import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.runreel.app",
  appName: "RunReel",
  webDir: "dist/public",
  server: {
    androidScheme: "https",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: "#0f172a",
      showSpinner: false,
    },
    StatusBar: {
      style: "Dark",
      backgroundColor: "#0f172a",
    },
    Geolocation: {
      permissions: {
        ios: "NSLocationWhenInUseUsageDescription",
        android: "android.permission.ACCESS_FINE_LOCATION",
      },
    },
  },
  ios: {
    contentInset: "always",
    preferredContentMode: "mobile",
    backgroundColor: "#0f172a",
  },
  android: {
    backgroundColor: "#0f172a",
  },
};

export default config;
