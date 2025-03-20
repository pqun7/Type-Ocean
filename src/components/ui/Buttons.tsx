import { Magnetic } from "./magnetic";

export const Button1 = ({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) => {
  const pointerColor = "120, 110, 230";
  const secondColor = "140, 200, 240";

  return (
    <div className={`flex justify-center ${className}`}>
      <button
        onClick={onClick}
        className={`relative overflow-hidden w-full max-w-xs text-lg font-semibold 
          text-white transition-all duration-300 transform rounded-xl 
          backdrop-blur-lg border hover:scale-[1.02] group
          ${
            /* استخدام نفس أنماط الخلفية مثل البطاقات */
            "bg-[rgba(140,200,240,0.15)] border-[rgba(120,110,230,0.2)]"
          }`}
        style={{
          background: `linear-gradient(45deg, rgba(${pointerColor},0.1), rgba(${secondColor},0.1))`,
        }}
      >
        {/* تأثير التوهج عند hover */}
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <div 
            className="absolute w-[150%] h-[150%] -top-1/4 -left-1/4 bg-gradient-radial from-[rgba(140,200,240,0.4)] to-transparent"
            style={{ clipPath: 'circle(25% at 50% 100%)' }}
          />
        </div>

        <div className="relative flex items-center justify-center space-x-2 z-10 py-3.5 px-6">
          <span className="text-gray-100 group-hover:text-white transition-colors">
            {children}
          </span>
        </div>

        <div className="absolute inset-0 rounded-xl border-[0.5px] border-white/10 pointer-events-none" />
      </button>
    </div>
  );
};

export const Button2 = ({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  customBorder?: string;
  customPaddingX?: number;
  customPaddingY?: number;
  className?: string;
}) => {
  const springOptions = { bounce: 0.1 };
  return (
    <Magnetic
      intensity={0.2}
      springOptions={springOptions}
      actionArea="global"
      range={120}
    >
      <button
        onClick={onClick}
        className={`relative inline-flex h-12 overflow-hidden rounded-full p-[2px] transition-all duration-300  ${className}`}
      >
        <span className="absolute inset-[-1000%] animate-[spin_2s_linear_infinite] bg-[conic-gradient(from_90deg_at_50%_50%,rgba(140,200,240,0.8)_0%,rgba(80,60,190,0.8)_50%,rgba(140,200,240,0.8)_100%)]" />
        <span
          className={`inline-flex h-full w-full cursor-pointer items-center justify-center rounded-full bg-n-7 px-6 py-1 text-sm font-medium text-[rgb(200,240,255)] backdrop-blur-3xl transition-all duration-300 hover:bg-n-6`}
        >
          {children}
        </span>
      </button>
    </Magnetic>
  );
};