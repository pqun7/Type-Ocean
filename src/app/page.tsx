import Main from "@/components/Main";
import Benefits from "@/components/Benefits";
import Pricing from "@/components/Pricing";
import Header from "@/components/layout/Header/Header";

export default function Home() {
  return (
    <>
    <Header/>
      <div className="pt-[4.75rem] lg:pt-[5.25rem] overflow-hidden">
        <Main />
        <Benefits />
        <Pricing />
      </div>
    </>
  );
}
