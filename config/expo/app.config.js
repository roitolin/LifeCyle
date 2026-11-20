const notificationMode =
  process.env.EAS_BUILD_PROFILE === 'development' ? 'development' : 'production';

module.exports = {
  expo: {
    backgroundColor: '#d7d8d5',
    name: "LifeCycle",
    slug: "lifecycle",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/Icon/Icon.png",
    scheme: "lifecycle",
    userInterfaceStyle: "light",
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.Roi.lifecycle",
    },
    android: {
      backgroundColor: '#d7d8d5',
      package: "com.Roi.lifecycle",
      googleServicesFile: "./google-services.json",
      softwareKeyboardLayoutMode: "resize",
      permissions: [],
    },
    plugins: [
      [
        'expo-navigation-bar',
        {
          style: 'light',
          hidden: false,
          enforceContrast: false,
        }
      ],
      'expo-secure-store',
      'expo-web-browser',
      [
        'expo-image-picker',
        {
          photosPermission: 'Allow LifeCycle to access photos and videos you choose to upload.',
          cameraPermission: 'Allow LifeCycle to take pictures or videos when you choose the camera.',
          microphonePermission: 'Allow LifeCycle to record audio when capturing video.',
        },
      ],
      "@react-native-community/datetimepicker",
      "expo-asset",
      [
        "expo-audio",
        {
          microphonePermission: "Allow LifeCycle to record voice messages in chat.",
        },
      ],
      "expo-font",
      "expo-sharing",
      [
        "expo-status-bar",
        {
          "style": "dark",
          "hidden": false,
        }
      ],
      [
        "expo-splash-screen",
        {
          image: "./assets/Icon/IconTraparent.png",
          imageWidth: 188,
          resizeMode: "contain",
          backgroundColor: "#17382f",
        },
      ],
      [
        "expo-notifications",
        {
          icon: "./assets/Icon/IconTraparent.png",
          color: "#17382f",
          defaultChannel: "lifecycle-alerts-v2",
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
