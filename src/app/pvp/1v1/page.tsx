import Pvp1v1Client from "@/components/pvp/Pvp1v1Client";
import Header from "@/components/layout/Header/Header";

export default function Page() {
  return (
    <>
      <Header />
      <div className="pt-[4.75rem] lg:pt-[5.25rem]">
        <Pvp1v1Client />
      </div>
    </>
  );
}
