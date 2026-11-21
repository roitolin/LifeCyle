import type { ComponentProps } from "react";
import ImageWithSkeleton from "@/components/ImageWithSkeleton";
import { getDeliveredImageUrl } from "@/utils/imageDelivery";

type Props = Omit<ComponentProps<typeof ImageWithSkeleton>, "source" | "fallbackSource" | "pulsePlaceholder"> & {
  uri: string;
  deliveryWidth: number;
  deliveryHeight?: number;
};

export default function AnimatedRemoteImage({ uri, deliveryWidth, deliveryHeight, ...props }: Props) {
  const deliveredUri = getDeliveredImageUrl(uri, { width: deliveryWidth, height: deliveryHeight });
  return (
    <ImageWithSkeleton
      {...props}
      source={{ uri: deliveredUri, cache: "force-cache" }}
      fallbackSource={deliveredUri === uri ? undefined : { uri, cache: "force-cache" }}
      pulsePlaceholder
    />
  );
}
