import Header from "@/components/layout/Header/Header";
import Main from "@/components/Main";
import dynamic from "next/dynamic";

const Benefits = dynamic(() => import("@/components/Benefits"), {
  loading: () => null,
});

const Pricing = dynamic(() => import("@/components/Pricing"), {
  loading: () => null,
});

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
