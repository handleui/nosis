"use client";

import type { ReactNode } from "react";
import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import AuthGuard from "@nosis/components/auth-guard";
import ResizableGrid, {
  type ResizableGridHandle,
} from "@nosis/components/resizable-grid";
import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from "@nosis/ui/tooltip";

const DiffView = dynamic(() => import("@nosis/components/diff-view"), {
  ssr: false,
});

const LEFT_SIDEBAR_WIDTH = 300;

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
const imgFrameBranch =
  "https://www.figma.com/api/mcp/asset/527b4b1c-1b31-4962-affc-2c501def8d30";
const imgFramePrBadge =
  "https://www.figma.com/api/mcp/asset/4b520583-c7ba-4636-b384-1401e793e629";
const imgFrameChevron =
  "https://www.figma.com/api/mcp/asset/56549334-809d-4482-8da6-fe0b71410e0e";

function DiffBadge() {
  return (
    <div className="flex shrink-0 items-center gap-2 text-xs leading-[1.2]">
      <p className="shrink-0 text-[#00ec7e]">+440</p>
      <p className="shrink-0 text-[#f53b3a]">-1130</p>
    </div>
  );
}

interface IconTooltipButtonProps {
  tooltip: string;
  children: ReactNode;
  onClick?: () => void;
  pressed?: boolean;
  className?: string;
}

function IconTooltipButton({
  tooltip,
  children,
  onClick,
  pressed,
  className,
}: IconTooltipButtonProps) {
  return (
    <TooltipRoot>
      <TooltipTrigger
        aria-label={tooltip}
        aria-pressed={pressed}
        className={
          className ??
          "flex size-5 cursor-pointer items-center justify-center rounded-[4px] hover:bg-[#f6f6f6]"
        }
        onClick={onClick}
        render={<button type="button" />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </TooltipRoot>
  );
}

export default function CodeLayout({ children }: { children: ReactNode }) {
  const gridRef = useRef<ResizableGridHandle | null>(null);
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [isPrPanelOpen, setIsPrPanelOpen] = useState(true);

  const toggleLeftSidebar = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) {
      setIsLeftSidebarOpen((prev) => !prev);
      return;
    }

    const nextOpen = grid.widths.left === 0;
    grid.setWidths(nextOpen ? LEFT_SIDEBAR_WIDTH : 0, 0, 180);
    setIsLeftSidebarOpen(nextOpen);
  }, []);

  const handleLeftCollapsedChange = useCallback((collapsed: boolean) => {
    setIsLeftSidebarOpen(!collapsed);
  }, []);

  return (
    <AuthGuard>
      <TooltipProvider>
        <div className="flex h-dvh overflow-hidden bg-white">
          <ResizableGrid
            allowUserResize={false}
            center={
              <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
                <div className="flex h-10 w-full shrink-0 items-center gap-3 border-subtle border-b px-4">
                  <div className="flex min-h-0 min-w-0 flex-1 items-center gap-3">
                    <IconTooltipButton
                      className="flex size-6 cursor-pointer items-center justify-center rounded-[4px] hover:bg-[#f6f6f6]"
                      onClick={toggleLeftSidebar}
                      pressed={isLeftSidebarOpen}
                      tooltip={
                        isLeftSidebarOpen ? "Hide sidebar" : "Show sidebar"
                      }
                    >
                      <img
                        alt=""
                        className={`size-3 shrink-0 transition-transform ${isLeftSidebarOpen ? "" : "rotate-180"}`}
                        src={imgFrameExpand}
                      />
                    </IconTooltipButton>
                    <p className="shrink-0 font-sans text-black text-sm leading-normal">
                      Harden the SDK error payload
                    </p>
                    <div className="flex shrink-0 items-center justify-center gap-2">
                      <img
                        alt=""
                        className="size-3 shrink-0"
                        src={imgFrameBranch}
                      />
                      <p className="shrink-0 font-sans text-[#808080] text-sm leading-[1.2]">
                        feat/sdk-mcp
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <div className="flex shrink-0 items-center justify-center gap-1.5 rounded-[6px] bg-[#dfffdf] px-1 py-[3px]">
                      <img
                        alt=""
                        className="size-3 shrink-0"
                        src={imgFramePrBadge}
                      />
                      <p className="shrink-0 font-sans text-[#54c723] text-xs leading-[1.2]">
                        #159
                      </p>
                    </div>
                    <IconTooltipButton
                      className="flex size-6 cursor-pointer items-center justify-center rounded-[4px] hover:bg-[#f6f6f6]"
                      onClick={() => setIsPrPanelOpen((prev) => !prev)}
                      pressed={isPrPanelOpen}
                      tooltip={
                        isPrPanelOpen
                          ? "Hide pull request panel"
                          : "Show pull request panel"
                      }
                    >
                      <img
                        alt=""
                        className={`size-3 shrink-0 transition-transform ${isPrPanelOpen ? "" : "rotate-180"}`}
                        src={imgFrameChevron}
                      />
                    </IconTooltipButton>
                  </div>
                </div>

                <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                  <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                    {children}
                  </div>

                  {isPrPanelOpen ? (
                    <div className="flex h-full w-[425px] shrink-0 flex-col overflow-hidden border-subtle border-l">
                      <div className="flex w-full shrink-0 flex-col items-start gap-6 px-4 pt-3 pb-6">
                        <div className="flex w-full shrink-0 flex-col items-start gap-3 whitespace-pre-wrap font-sans leading-[1.2]">
                          <p className="w-full shrink-0 text-[#808080] text-xs">
                            handleui/detent #159
                          </p>
                          <p className="w-full shrink-0 text-black text-xl">
                            feat(sdk): add SDK and MCP server packages
                          </p>
                        </div>

                        <div className="flex w-full shrink-0 flex-wrap content-center items-center gap-3">
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

                          <p className="shrink-0 font-sans text-black text-sm leading-[1.2]">
                            8 files
                          </p>

                          <DiffBadge />
                        </div>
                      </div>

                      <div className="flex h-10 w-full shrink-0 items-center justify-center border-subtle border-b">
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

                      <div className="flex w-full shrink-0 flex-col items-start px-4 py-6">
                        <div className="flex h-6 w-full shrink-0 items-center overflow-hidden rounded-[4px] border border-[#e2e2e2] px-2">
                          <p className="shrink-0 font-sans text-[#808080] text-xs leading-normal">
                            Find
                          </p>
                        </div>
                      </div>

                      <div className="min-h-0 w-full flex-1 overflow-y-auto overscroll-none">
                        <DiffView />
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            }
            initialLeft={LEFT_SIDEBAR_WIDTH}
            initialRight={0}
            left={
              <div className="flex h-full w-full flex-col items-start justify-between">
                <div className="flex w-full flex-col items-start">
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
                    <div className="flex shrink-0 items-start gap-1.5">
                      <IconTooltipButton tooltip="Create branch">
                        <img
                          alt=""
                          className="size-3 shrink-0"
                          src={imgFramePlus}
                        />
                      </IconTooltipButton>
                      <IconTooltipButton tooltip="Expand project">
                        <img
                          alt=""
                          className="size-3 shrink-0"
                          src={imgFrameExpand}
                        />
                      </IconTooltipButton>
                    </div>
                  </div>

                  <div className="flex h-10 w-full shrink-0 items-center justify-between overflow-hidden bg-[#f6fbff] px-4 py-3 font-sans">
                    <p className="shrink-0 text-[#0080ff] text-sm leading-normal">
                      Harden the SDK error payload
                    </p>
                    <DiffBadge />
                  </div>

                  <div className="flex h-10 w-full shrink-0 items-center justify-between overflow-hidden px-4 py-3 font-sans">
                    <p className="shrink-0 text-black text-sm leading-normal">
                      handleui/beta-sigma
                    </p>
                    <DiffBadge />
                  </div>

                  <div className="flex h-10 w-full shrink-0 items-center justify-between overflow-hidden px-4 py-3 font-sans">
                    <p className="shrink-0 text-black text-sm leading-normal">
                      handleui/choppleganger
                    </p>
                    <DiffBadge />
                  </div>

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
                    <div className="flex shrink-0 items-start gap-1.5">
                      <IconTooltipButton tooltip="Create branch">
                        <img
                          alt=""
                          className="size-3 shrink-0"
                          src={imgFramePlus}
                        />
                      </IconTooltipButton>
                      <IconTooltipButton tooltip="Expand project">
                        <img
                          alt=""
                          className="size-3 shrink-0"
                          src={imgFrameExpand}
                        />
                      </IconTooltipButton>
                    </div>
                  </div>

                  <div className="flex h-10 w-full shrink-0 items-center justify-between overflow-hidden px-4 py-3 font-sans">
                    <p className="shrink-0 text-black text-sm leading-normal">
                      handleui/beta-sigma
                    </p>
                    <DiffBadge />
                  </div>

                  <div className="flex h-10 w-full shrink-0 items-center justify-between overflow-hidden px-4 py-3 font-sans">
                    <p className="shrink-0 text-black text-sm leading-normal">
                      handleui/choppleganger
                    </p>
                    <DiffBadge />
                  </div>
                </div>

                <div className="flex h-10 w-full shrink-0 items-center justify-between border-subtle border-t px-4 py-2">
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
                  <div className="flex shrink-0 items-center gap-1.5">
                    <IconTooltipButton tooltip="Project grid">
                      <img
                        alt=""
                        className="size-4 shrink-0"
                        src={imgFrameGrid}
                      />
                    </IconTooltipButton>
                    <IconTooltipButton tooltip="Project settings">
                      <img
                        alt=""
                        className="size-3 shrink-0"
                        src={imgFrameSettings}
                      />
                    </IconTooltipButton>
                  </div>
                </div>
              </div>
            }
            onLeftCollapsedChange={handleLeftCollapsedChange}
            ref={gridRef}
            right={null}
          />
        </div>
      </TooltipProvider>
    </AuthGuard>
  );
}
