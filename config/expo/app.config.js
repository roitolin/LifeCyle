const notificationMode =
  process.env.EAS_BUILD_PROFILE === 'development' ? 'development' : 'production';

module.exports = {
  expo: {
    backgroundColor: '#17382f',
    name: "LifeCycle",
    slug: "lifecycle",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/Icon/AppICONs.png",
    scheme: "lifecycle",
    userInterfaceStyle: "automatic",
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.Roi.lifecycle",
    },
    android: {
      backgroundColor: '#17382f',
      package: "com.Roi.lifecycle",
      googleServicesFile: "./google-services.json",
      softwareKeyboardLayoutMode: "resize",
      adaptiveIcon: {
        foregroundImage: "./assets/Icon/AppICONTransparents.png",
        backgroundColor: "#607286",
      },
      permissions: [],
    },
    androidNavigationBar: {
      backgroundColor: '#f8f6f2',
      barStyle: 'dark-content',
      enforceContrast: false,
    },
    plugins: [
      'expo-secure-store',
      "@react-native-community/datetimepicker",
      "expo-audio",
      "expo-font",
      "expo-sharing",
      [
        "expo-splash-screen",
        {
          image: "./assets/Icon/AppICONTransparents.png",
          imageWidth: 188,
          resizeMode: "contain",
          backgroundColor: "#17382f",
        },
      ],
      [
        "expo-notifications",
        {
          icon: "./assets/Icon/AppICONTransparents.png",
          color: "#17382f",
          defaultChannel: "lifecycle-alerts",
          mode: notificationMode,
        },
      ],
    ],
    extra: {
      eas: {
        projectId: "f9723096-48ee-4c7c-bcf7-090a3436467a",
      },
    },

  },
};
