"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import AuthGuard from "@nosis/components/auth-guard";
import ResizableGrid from "@nosis/components/resizable-grid";

const DiffView = dynamic(() => import("@nosis/components/diff-view"), {
  ssr: false,
});

// Figma asset URLs
const imgRectangle2 =
  "https://www.figma.com/api/mcp/asset/b139ad5c-36ba-4890-a978-5625985ce76b";
const imgFramePlus =
  "https://www.figma.com/api/mcp/asset/04074f05-78c1-4915-85c6-06d7fa6d6ad6";
const imgFrameExpand =
  "https://www.figma.com/api/mcp/asset/e780731d-eac1-4e8e-9e43-dddfc17b67ee";
const imgFrameAddProject =
  "https://www.figma.com/api/mcp/asset/5ed5eee2-5d04-41b1-9774-08038fed05e0";
const imgFrameGrid =
  "https://www.figma.com/api/mcp/asset/b91a1786-2023-4798-9f70-249b38cecbfb";
const imgFrameSettings =
  "https://www.figma.com/api/mcp/asset/22378177-59cd-4d12-8e45-07b3d27bca72";
const imgFrameArrow =
  "https://www.figma.com/api/mcp/asset/bfee6a5a-c590-4efa-8529-b69738154b76";

function DiffBadge() {
  return (
    <div className="flex shrink-0 items-center gap-2 text-sm leading-[1.2]">
      <p className="shrink-0 text-[#00ec7e]">+440</p>
      <p className="shrink-0 text-[#f53b3a]">-1130</p>
    </div>
  );
}

export default function CodeLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex h-dvh overflow-hidden bg-white">
        <ResizableGrid
          center={children}
          initialLeft={300}
          initialRight={425}
          left={
            <div className="flex h-full w-full flex-col items-start justify-between">
              {/* Top section: projects + branches */}
              <div className="flex w-full flex-col items-start">
                {/* Detent project header */}
                <div className="flex w-full items-center justify-between px-4 py-3">
                  <div className="flex shrink-0 items-center justify-center gap-2.5">
                    <img
                      alt=""
                      className="size-4 shrink-0 rounded-[2px] bg-[#d9d9d9] object-cover"
                      src={imgRectangle2}
                    />
                    <p className="shrink-0 font-sans text-[#808080] text-xs leading-normal">
                      Detent
                    </p>
                  </div>
                  <div className="flex shrink-0 items-start gap-2">
                    <img
                      alt=""
                      className="size-3 shrink-0"
                      src={imgFramePlus}
                    />
                    <img
                      alt=""
                      className="size-3 shrink-0"
                      src={imgFrameExpand}
                    />
                  </div>
                </div>

                {/* Detent: Harden the SDK error payload (active) */}
                <div className="flex h-10 w-full shrink-0 items-center justify-between overflow-hidden bg-[#f6fbff] px-4 py-3 font-sans">
                  <p className="shrink-0 text-[#0080ff] text-sm leading-normal">
                    Harden the SDK error payload
                  </p>
                  <DiffBadge />
                </div>

                {/* Detent: handleui/beta-sigma */}
                <div className="flex h-10 w-full shrink-0 items-center justify-between overflow-hidden px-4 py-3 font-sans">
                  <p className="shrink-0 text-black text-sm leading-normal">
                    handleui/beta-sigma
                  </p>
                  <DiffBadge />
                </div>

                {/* Detent: handleui/choppleganger */}
                <div className="flex h-10 w-full shrink-0 items-center justify-between overflow-hidden px-4 py-3 font-sans">
                  <p className="shrink-0 text-black text-sm leading-normal">
                    handleui/choppleganger
                  </p>
                  <DiffBadge />
                </div>

                {/* Nosis project header */}
                <div className="flex w-full items-center justify-between px-4 py-3">
                  <div className="flex shrink-0 items-center justify-center gap-2.5">
                    <img
                      alt=""
                      className="size-4 shrink-0 rounded-[2px] bg-[#d9d9d9] object-cover"
                      src={imgRectangle2}
                    />
                    <p className="shrink-0 font-sans text-[#808080] text-xs leading-normal">
                      Nosis
                    </p>
                  </div>
                  <div className="flex shrink-0 items-start gap-2">
                    <img
                      alt=""
                      className="size-3 shrink-0"
                      src={imgFramePlus}
                    />
                    <img
                      alt=""
                      className="size-3 shrink-0"
                      src={imgFrameExpand}
                    />
                  </div>
                </div>

                {/* Nosis: handleui/beta-sigma */}
                <div className="flex h-10 w-full shrink-0 items-center justify-between overflow-hidden px-4 py-3 font-sans">
                  <p className="shrink-0 text-black text-sm leading-normal">
                    handleui/beta-sigma
                  </p>
                  <DiffBadge />
                </div>

                {/* Nosis: handleui/choppleganger */}
                <div className="flex h-10 w-full shrink-0 items-center justify-between overflow-hidden px-4 py-3 font-sans">
                  <p className="shrink-0 text-black text-sm leading-normal">
                    handleui/choppleganger
                  </p>
                  <DiffBadge />
                </div>
              </div>

              {/* Bottom bar: Add Project */}
              <div className="flex h-10 w-full shrink-0 items-center justify-between border-[#f1f1f2] border-t px-4 py-2">
                <div className="flex shrink-0 items-center gap-2.5">
                  <img
                    alt=""
                    className="size-4 shrink-0"
                    src={imgFrameAddProject}
                  />
                  <p className="shrink-0 font-sans text-black text-xs leading-normal">
                    Add Project
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  <img alt="" className="size-4 shrink-0" src={imgFrameGrid} />
                  <img
                    alt=""
                    className="size-3 shrink-0"
                    src={imgFrameSettings}
                  />
                </div>
              </div>
            </div>
          }
          right={
            <div className="flex h-full w-full flex-col items-center overflow-hidden">
              {/* PR info */}
              <div className="flex w-full shrink-0 flex-col items-start gap-6 px-4 pt-3 pb-6">
                <div className="flex w-full shrink-0 flex-col items-start gap-3 whitespace-pre-wrap font-sans leading-[1.2]">
                  <p className="w-full shrink-0 text-[#808080] text-xs">
                    handleui/detent #159
                  </p>
                  <p className="w-full shrink-0 text-black text-xl">
                    feat(sdk): add SDK and MCP server packages
                  </p>
                </div>

                {/* Author / branch / stats */}
                <div className="flex w-full shrink-0 flex-wrap content-center items-center gap-3">
                  {/* Author */}
                  <div className="flex shrink-0 items-center gap-2">
                    <img
                      alt=""
                      className="size-3 shrink-0 rounded-[2px] bg-[#d9d9d9] object-cover"
                      src={imgRectangle2}
                    />
                    <p className="shrink-0 font-sans text-black text-sm leading-[1.2]">
                      Rodrigo Jiménez
                    </p>
                  </div>

                  {/* Branch: feat/sdk-mcp → main */}
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="flex shrink-0 items-center justify-center rounded-[4px] bg-[#f0f0f0] px-1 py-0.5">
                      <p className="shrink-0 font-sans text-black text-sm leading-[1.2]">
                        feat/sdk-mcp
                      </p>
                    </div>
                    <img
                      alt=""
                      className="size-3 shrink-0"
                      src={imgFrameArrow}
                    />
                    <div className="flex shrink-0 items-center justify-center rounded-[4px] bg-[#f0f0f0] px-1 py-0.5">
                      <p className="shrink-0 font-sans text-black text-sm leading-[1.2]">
                        main
                      </p>
                    </div>
                  </div>

                  {/* 8 files */}
                  <p className="shrink-0 font-sans text-black text-sm leading-[1.2]">
                    8 files
                  </p>

                  {/* +440 -1130 */}
                  <DiffBadge />
                </div>
              </div>

              {/* Tabs */}
              <div className="flex h-10 w-full shrink-0 items-center justify-center border-[#f1f1f2] border-b">
                <div className="flex min-h-0 min-w-0 flex-1 items-center gap-4 px-2">
                  <div className="flex h-10 shrink-0 items-center px-2">
                    <p className="shrink-0 font-sans text-black text-xs leading-normal">
                      Conversation
                    </p>
                  </div>
                  <div className="flex h-10 shrink-0 items-center border-black border-b px-2">
                    <p className="shrink-0 font-sans text-black text-xs leading-normal">
                      Changes
                    </p>
                  </div>
                  <div className="flex h-10 shrink-0 items-center gap-3 px-2">
                    <div className="size-1.5 shrink-0 bg-[#ffd658]" />
                    <p className="shrink-0 font-sans text-black text-xs leading-normal">
                      Checks
                    </p>
                  </div>
                  <div className="flex h-10 shrink-0 items-center px-2">
                    <p className="shrink-0 font-sans text-black text-xs leading-normal">
                      Files
                    </p>
                  </div>
                </div>
              </div>

              {/* Find input */}
              <div className="flex w-full shrink-0 flex-col items-start px-4 py-6">
                <div className="flex h-6 w-full shrink-0 items-center overflow-hidden rounded-[4px] border border-[#e2e2e2] px-2">
                  <p className="shrink-0 font-sans text-[#808080] text-xs leading-normal">
                    Find
                  </p>
                </div>
              </div>

              {/* Diff content */}
              <div className="min-h-0 w-full flex-1 overflow-y-auto">
                <DiffView />
              </div>
            </div>
          }
        />
      </div>
    </AuthGuard>
  );
}
