export default function SculptureMark({className = ''}) {
  return <img
    className={`sculpture-mark ${className}`.trim()}
    src="/brand/medusae-sculpture-v1.png"
    width={1254}
    height={1254}
    alt=""
    aria-hidden="true"
    draggable={false}
  />;
}
