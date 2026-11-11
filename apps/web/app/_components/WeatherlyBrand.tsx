import Image from "next/image";

const assets = {
  wordmark: {
    src: "/brand/handoffs/weatherly-wordmark.png",
    width: 1500,
    height: 350,
  },
  mark: { src: "/brand/handoffs/weatherly-mark.png", width: 1500, height: 625 },
};

export function WeatherlyBrand({
  variant = "wordmark",
  decorative = false,
}: {
  variant?: keyof typeof assets;
  decorative?: boolean;
}) {
  return (
    <span className="weatherly-brand-tile">
      <Image
        {...assets[variant]}
        alt={decorative ? "" : "Weatherly Transaction Co."}
        unoptimized
      />
    </span>
  );
}
