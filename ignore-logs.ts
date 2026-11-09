import { LogBox } from 'react-native';

// NativeWind's interop layer reads ImageBackground while registering components,
// which triggers React Native's deprecation warning even when the app never uses it.
LogBox.ignoreLogs(['ImageBackground is deprecated']);
