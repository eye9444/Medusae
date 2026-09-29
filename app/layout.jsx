import '@xyflow/react/dist/style.css';
import './globals.css';
import './atlas.css';

export const metadata = {title: 'Medusae · Follow the threads', description: 'Explore the connections behind your code.'};
export default function RootLayout({children}) {
  return <html lang="en"><body>{children}</body></html>;
}
