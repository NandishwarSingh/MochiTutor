// A real-world picture pinned to the board, with its credit underneath.
export function Picture({
  src,
  title,
  credit,
  caption,
}: {
  src: string;
  title: string;
  credit: string;
  caption?: string;
}) {
  return (
    <figure className="widget picture">
      <img src={src} alt={title} decoding="async" />
      {caption && <figcaption className="widget-caption">{caption}</figcaption>}
      <small className="picture-credit">{credit}</small>
    </figure>
  );
}
