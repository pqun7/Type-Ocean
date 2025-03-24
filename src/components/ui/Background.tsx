import React, { HTMLAttributes } from "react";

const Background = ({ className }: HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      className={`fixed inset-0 z-[-1] overflow-hidden bg-[#0a0a1f] ${className}`}
    >
      {/* طبقة التدرج الأساسية */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#1B1B2E] via-[#1D2B3A] to-[#0E1117]" />

      {/* تأثير الفقاعات المتحركة */}
      <div className="absolute bottom-0 left-1/4 w-15 h-96 bg-gradient-to-r from-[#69d0ff55] to-[#8A6BFF55] rounded-full blur-[100px] animate-bubble opacity-55" />
      <div className="absolute inset-0 bg-grid opacity-15" />

      {/* تأثيرات الضوء الرئيسية */}
      <div className="absolute -top-20 -left-40 w-[800px] h-[800px] bg-gradient-to-r from-[#69d0ff20] to-[#8A6BFF20] rounded-full blur-[150px] animate-pulse-slow" />
      <div className="absolute -top-40 -right-60 w-[700px] h-[700px] bg-gradient-to-l from-[#69d0ff22] to-[#8A6BFF22] rounded-full blur-[120px] rotate-45" />

      {/* تموجات مائية */}
      <div className="absolute inset-0 bg-[radial-gradient(circle,#69d0ff22_1px,transparent_1px)] bg-[size:20px_20px] opacity-10" />
    </div>
  );
};

export default Background;
