import logoSvg from '@/assets/logo.svg';

export function WebBrowserHome(): React.ReactElement {
  return (
    <div
      data-testid="web-browser-home"
      className="absolute inset-0 z-10 flex items-center justify-center bg-background px-6"
    >
      <img src={logoSvg} alt="ClawX" className="h-24 w-24" />
    </div>
  );
}

export default WebBrowserHome;
