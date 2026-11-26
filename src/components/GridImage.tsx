import { useLayoutEffect, useRef, useState } from "react";
import type { ImgHTMLAttributes } from "react";

interface GridImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src: string;
}

/**
 * A shelf cover that fades in once its bitmap is ready.
 *
 * The grid only mounts a screenful of tiles, so this is a polish detail rather
 * than a loading strategy — but it keeps a freshly mounted row from popping a
 * hard-edged photo into the parchment placeholder while scrolling.
 */
export function GridImage({ src, className, onLoad, ...rest }: GridImageProps) {
  const ref = useRef<HTMLImageElement>(null);
  // Deriving `loaded` from the source means a changed cover starts hidden
  // immediately, without an intermediate frame at the old opacity.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const loaded = loadedSrc === src;

  useLayoutEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth > 0) setLoadedSrc(src);
  }, [src]);

  return (
    <img
      {...rest}
      ref={ref}
      src={src}
      data-loaded={loaded ? "true" : "false"}
      onLoad={(event) => {
        setLoadedSrc(src);
        onLoad?.(event);
      }}
      className={`tile-cover ${className ?? ""}`}
    />
  );
}
