export const Rings: React.FC = () => {
  return (
    <div className="absolute top-1/2 left-1/2 w-[51.375rem] aspect-square border border-n-2/10 rounded-full -translate-x-1/2 -translate-y-1/2">
      <div className="absolute top-1/2 left-1/2 w-[36.125rem] aspect-square border border-n-2/10 rounded-full -translate-x-1/2 -translate-y-1/2"></div>
      <div className="absolute top-1/2 left-1/2 w-[23.125rem] aspect-square border border-n-2/10 rounded-full -translate-x-1/2 -translate-y-1/2"></div>
    </div>
  );
};

export const SideLines: React.FC = () => {
  return (
    <>
      <div className="absolute top-0 left-5 w-0.25 h-full bg-n-6"></div>
      <div className="absolute top-0 right-5 w-0.25 h-full bg-n-6"></div>
    </>
  );
};

export const BackgroundLetters: React.FC = () => {
  return (
    <>
      <div className="animate-fourth absolute top-[1rem] right-[10%] w-12 h-12 blur-sm">K</div>
      <div className="animate-fourth absolute top-[5rem] right-2 w-7 h-7">s</div>
      <div className="animate-fourth absolute top-80 right-[75%] w-5 h-5">T</div>
      <div className="absolute top-[22rem] right-[10%] w-14 h-14 animate-fourth">m</div>
      <div className="animate-first absolute top-[1rem] left-[8%] w-5 h-16 blur-md">R</div>
      <div className="animate-first absolute top-[20rem] right-[20%] w-5 h-16 blur-md">j</div>
      
     
    </>
  );
};

export const HambugerMenu: React.FC = () => {
  return (
    <div className="absolute inset-0 pointer-events-none lg:hidden">
      <Rings />
      {/* <SideLines /> */}
      {/* <BackgroundCircles /> */}
    </div>
  );
};
