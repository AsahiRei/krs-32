import { Link } from 'expo-router';
import { Text, View } from 'react-native';

export default function NotFoundScreen() {
  return (
    <View className="flex-1 items-center justify-center gap-4 bg-background p-6">
      <Text className="font-inter-semibold text-[18px] text-foreground">Page not found</Text>
      <Link href="/" className="py-3 font-inter-semibold text-[15px] text-accent">
        Back to library
      </Link>
    </View>
  );
}
