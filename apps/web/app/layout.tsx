import "./styles.css";

export const metadata = {
  title: "HawkCode",
  description: "Self-hosted agent coding app"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
