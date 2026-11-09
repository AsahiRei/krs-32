import { Image } from 'react-native';

export function KrsIcon({ size }: { size: number }) {
  return (
    <Image
      source={require('../assets/images/krs32-icon.png')}
      style={{ width: size, height: size }}
      resizeMode="contain"
    />
  );
}
