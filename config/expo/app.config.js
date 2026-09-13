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
    userInterfaceStyle: "automatic",
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.Roi.lifecycle",
    },
    android: {
      backgroundColor: '#d7d8d5',
      package: "com.Roi.lifecycle",
      googleServicesFile: "./google-services.json",
      softwareKeyboardLayoutMode: "resize",
      adaptiveIcon: {
        foregroundImage: "./assets/Icon/IconTraparent.png",
        backgroundColor: "#607286",
      },
      permissions: [],
    },
    plugins: [
      [
        'expo-navigation-bar',
        {
          style: 'dark',
          hidden: false,
          enforceContrast: false,
        }
      ],
      'expo-secure-store',
      "@react-native-community/datetimepicker",
      "expo-asset",
      "expo-audio",
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
