const imgEllipse3 =
  "https://www.figma.com/api/mcp/asset/164cc6b5-7758-42ab-bb5f-b2f162eafb73";
const imgGemini1 =
  "https://www.figma.com/api/mcp/asset/3f067ade-e419-4b15-a904-70085c2071ba";
const imgFrame8 =
  "https://www.figma.com/api/mcp/asset/8862bc3f-ac82-4939-9cd6-99a1e9e1a7cd";
const imgFrame9 =
  "https://www.figma.com/api/mcp/asset/58bcba71-f3ca-4818-b5e7-5f047324d750";

export default function CodeHome() {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col items-center justify-end gap-8 overflow-y-auto overscroll-none p-4">
        <div className="flex w-full max-w-[750px] flex-col justify-end gap-8">
          {/* User message bubble */}
          <div className="flex w-full shrink-0 items-start overflow-hidden rounded-[16px] bg-[#f6fbff] p-4">
            <p className="min-h-0 min-w-0 flex-1 whitespace-pre-wrap font-sans text-black text-sm leading-[1.3]">
              i wanna forget execution and focus on backend stuff, so highest
              value is making sure errors a logged to database, set as a status
              the healer can pick up, heal, and log the heals (fixed) back to
              the database, right? OR lets focus first on the same flow but
              adding an autofix variant (different to heals, autofixes use the
              commands like biome fix etc, heals use AI)?? what do u think?
            </p>
          </div>

          {/* Agent response */}
          <div className="flex w-full shrink-0 flex-col items-start justify-center gap-6 px-4">
            <div className="flex max-w-[450px] shrink-0 items-start overflow-hidden rounded-[8px]">
              <p className="min-h-0 min-w-0 flex-1 whitespace-pre-wrap font-sans text-black text-sm leading-normal">
                I dont love it, i&apos;d rather you delete everything
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <p
                className="shrink-0 bg-gradient-to-l from-[#e4e4e4] via-[#0080ff] via-[57.212%] to-[#e4e4e4] bg-clip-text font-sans text-xs leading-normal"
                style={{ WebkitTextFillColor: "transparent" }}
              >
                Somelliering
              </p>
              <img alt="" className="size-1 shrink-0" src={imgEllipse3} />
              <p className="shrink-0 font-sans text-[#aaa] text-xs leading-normal">
                22m 13s
              </p>
            </div>
          </div>

          {/* Input box */}
          <div className="flex w-full shrink-0 flex-col items-start justify-center gap-6 overflow-hidden rounded-[4px] border border-[#f0f0f0] bg-white p-2">
            <div className="flex shrink-0 items-center justify-center px-2 py-1">
              <p className="shrink-0 font-sans text-[#aaa] text-sm leading-normal">
                Let&apos;s talk...
              </p>
            </div>
            <div className="flex w-full shrink-0 items-center justify-between">
              <div className="flex shrink-0 items-center gap-2 px-1">
                <img
                  alt=""
                  className="size-3 shrink-0 object-cover"
                  src={imgGemini1}
                />
                <p className="shrink-0 font-sans text-black text-sm leading-normal">
                  Gemini 3 Flash
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <img alt="" className="size-3 shrink-0" src={imgFrame8} />
                <div className="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-[4px] bg-black">
                  <img alt="" className="size-3 shrink-0" src={imgFrame9} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
