"use client";

import { Dialog } from "@base-ui-components/react/dialog";
import type * as React from "react";

import { cn } from "../../lib/utils";

const DialogRoot = Dialog.Root;
const DialogTrigger = Dialog.Trigger;
const DialogClose = Dialog.Close;
const DialogTitle = Dialog.Title;
const DialogDescription = Dialog.Description;

interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof Dialog.Popup> {}

const DialogContent = ({
  className,
  children,
  ...props
}: DialogContentProps) => (
  <Dialog.Portal>
    <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[1px]" />
    <Dialog.Popup
      className={cn(
        "fixed top-1/2 left-1/2 z-50 w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 rounded-[10px] border border-[#e8e8ea] bg-white p-6 shadow-[0_24px_64px_rgba(0,0,0,0.16)] outline-none",
        "transition-all duration-200 data-[ending-style]:scale-[0.98] data-[starting-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
        className
      )}
      {...props}
    >
      {children}
    </Dialog.Popup>
  </Dialog.Portal>
);

export {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
};
