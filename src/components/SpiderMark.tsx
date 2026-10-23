export function SpiderMark({ size = 30 }: { size?: number }) {
  return (
    <svg
      className="spider-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeWidth="0.8" strokeLinecap="round">
        <path d="M15.2 14.4 C10.4 12.8 7.4 9.2 5.3 4.9" />
        <path d="M14.2 16 C9.1 15.6 5.3 13.8 2.3 10.8" />
        <path d="M14.3 17.4 C9.4 18.6 5.8 20.8 3.6 24.2" />
        <path d="M15.3 18.7 C11.3 21.4 8.5 25.3 7.2 29.1" />
        <path d="M16.8 14.4 C21.6 12.8 24.6 9.2 26.7 4.9" />
        <path d="M17.8 16 C22.9 15.6 26.7 13.8 29.7 10.8" />
        <path d="M17.7 17.4 C22.6 18.6 26.2 20.8 28.4 24.2" />
        <path d="M16.7 18.7 C20.7 21.4 23.5 25.3 24.8 29.1" />
        <path d="M15.9 15.2 L17.2 21.5" opacity="0.5" />
      </g>
      <g fill="currentColor">
        <circle cx="15.9" cy="13.6" r="1.25" />
        <circle cx="15.9" cy="17" r="1.9" />
        <circle cx="16" cy="20.1" r="1.15" opacity="0.8" />
        <circle cx="5.3" cy="4.9" r="0.8" opacity="0.9" />
        <circle cx="2.3" cy="10.8" r="0.8" opacity="0.9" />
        <circle cx="3.6" cy="24.2" r="0.8" opacity="0.9" />
        <circle cx="7.2" cy="29.1" r="0.8" opacity="0.9" />
        <circle cx="26.7" cy="4.9" r="0.8" opacity="0.9" />
        <circle cx="29.7" cy="10.8" r="0.8" opacity="0.9" />
        <circle cx="28.4" cy="24.2" r="0.8" opacity="0.9" />
        <circle cx="24.8" cy="29.1" r="0.8" opacity="0.9" />
      </g>
    </svg>
  );
}
