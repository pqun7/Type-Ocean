'use client';

import Image from "next/image";
import Link from "next/link";
import Section from "@/components/ui/Section";
import { socials } from "@/constants";

const Footer = () => {
  

  return (
    <Section crosses className="!py-10 overflow-hidden h-40">
      <div className="container flex sm:justify-between justify-center items-center gap-10 max-sm:flex-col absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10">
        <p className="caption text-n-4 lg:block">
          © 2025 Type Ocean. All rights reserved.
        </p>
        <ul className="flex gap-5 flex-wrap">
          {socials.map((item) => (
            <Link
              key={item.id}
              href={item.iconUrl}
              target="_blank"
              className="flex items-center justify-center w-10 h-10 bg-n-7/30 rounded-full transition-colors hover:bg-n-6"
            >
              <Image src={item.icon} alt={item.title} width={16} height={16} />
            </Link>
          ))}
        </ul>
      </div>

      {/* Dynamic waves */}
      <div className="absolute -bottom-10 w-[200%] h-52 bg-repeat-x animate-wave-opacity">
        <div
          className="relative w-full h-full"
          style={{
            backgroundImage: `
              url("data:image/svg+xml,%3Csvg viewBox='0 0 1200 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 85C150 75 300 65 450 60C600 55 750 55 900 60C1050 65 1200 75 1200 85V100H0Z' fill='%232d3b5c'/%3E%3C/svg%3E"),
              url("data:image/svg+xml,%3Csvg viewBox='0 0 1200 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 80C200 70 400 65 600 68C800 71 1000 82 1200 85V100H0Z' fill='%234a67a3'/%3E%3C/svg%3E"),
              url("data:image/svg+xml,%3Csvg viewBox='0 0 1200 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 90C100 85 250 80 400 82C550 84 700 92 850 90C1000 88 1150 80 1200 75V100H0Z' fill='%2369d0ff'/%3E%3C/svg%3E")
            `,
            backgroundBlendMode: "screen",
            opacity: 0.4,
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#6a91cf] to-transparent" />
      </div>
    </Section>
  );
};

export default Footer;