// Minimal declarations so tsc can check Flow tool code without the real packages installed.
// They are deliberately loose; only the shapes that change how the tool code type-checks are typed.
declare module 'react' {
  namespace React {
    type FC<P = {}> = (p: P) => any;
    type ReactNode = any;
    type Dispatch<A> = (value: A) => void;
    type SetStateAction<S> = S | ((prev: S) => S);
    type ChangeEvent<T = any> = { target: T & { files: FileList | null; value: string; checked: boolean }; currentTarget: T; preventDefault(): void; stopPropagation(): void; [key: string]: any };
    type MouseEvent<T = any> = any;
    type KeyboardEvent<T = any> = any;
    type DragEvent<T = any> = { dataTransfer: DataTransfer; currentTarget: T; preventDefault(): void; stopPropagation(): void; [key: string]: any };
    type CSSProperties = any;
    type RefObject<T> = { current: T | null };
    type MutableRefObject<T> = { current: T };
    type UIEvent<T = any> = any;
    type FormEvent<T = any> = any;
    type FocusEvent<T = any> = any;
    type PointerEvent<T = any> = any;
    type WheelEvent<T = any> = any;
    type TouchEvent<T = any> = any;
    type ClipboardEvent<T = any> = any;
    type PropsWithChildren<P = {}> = P & { children?: any };
    type HTMLAttributes<T = any> = { [key: string]: any; className?: string; children?: any; style?: any; title?: string };
    type ButtonHTMLAttributes<T = any> = HTMLAttributes<T> & { disabled?: boolean; type?: string };
    type InputHTMLAttributes<T = any> = HTMLAttributes<T> & { disabled?: boolean; value?: any };
    type SelectHTMLAttributes<T = any> = HTMLAttributes<T> & { disabled?: boolean; value?: any };
    type TextareaHTMLAttributes<T = any> = HTMLAttributes<T> & { disabled?: boolean; value?: any };
  }
  const React: { memo<P = any>(component: (props: P) => any, areEqual?: any): any; [key: string]: any };
  export default React;
  export const useState: <T = any>(v?: T | (() => T)) => [T, (v: T | ((p: T) => T)) => void];
  export function useRef<T>(initial: T): { current: T };
  export function useRef<T>(initial: T | null): { current: T | null };
  export function useRef<T = undefined>(): { current: T | undefined };
  export const useMemo: <T>(f: () => T, d?: any[]) => T;
  export const useEffect: any;
  export const useCallback: <T>(f: T, d?: any[]) => T;
  export const memo: <P = any>(component: (props: P) => any, areEqual?: any) => any;
  export type FC<P = {}> = React.FC<P>;
  export type ReactNode = any;
  export type ChangeEvent<T = any> = React.ChangeEvent<T>;
  export type MouseEvent<T = any> = any;
  export type KeyboardEvent<T = any> = any;
  export type DragEvent<T = any> = React.DragEvent<T>;
  export type CSSProperties = any;
  export type RefObject<T> = { current: T | null };
  export type Dispatch<A> = React.Dispatch<A>;
  export type SetStateAction<S> = React.SetStateAction<S>;
  export const Fragment: any;
}
declare module 'react-dom/client' { const x: any; export = x; }
declare module 'flow-sdk' {
  type FlowImage = { base64: string; mimeType: string; mediaId: string };
  // Typed just enough for Parameters<typeof Flow.generate.image>[0] and result fields to resolve;
  // the index signatures keep the stub as permissive as the real SDK is for the tools' calls.
  export const Flow: {
    generate: {
      image(options: { prompt: string; modelDisplayName: string; aspectRatio: string; referenceImageMediaIds?: string[]; [key: string]: unknown }): Promise<FlowImage>;
      text(prompt: string, options?: { systemInstruction?: string; thinkingLevel?: string; images?: Array<{ base64: string; mimeType?: string }>; [key: string]: unknown }): Promise<{ text: string }>;
      video(options: { prompt: string; [key: string]: unknown }): Promise<FlowImage>;
      [key: string]: any;
    };
    upload(options: { base64: string; mimeType: string; name?: string; [key: string]: unknown }): Promise<{ mediaId: string; [key: string]: any }>;
    download(options: { base64: string; mimeType: string; filename: string; [key: string]: unknown }): Promise<any>;
    media: { select(options?: { filter?: string; [key: string]: unknown }): Promise<FlowImage & { name?: string }>; [key: string]: any };
    [key: string]: any;
  };
}
// Loaded by Flow's import map at runtime.
declare module 'mp4-muxer' { export const Muxer: any; export const ArrayBufferTarget: any; }
declare module 'pica' { const pica: any; export default pica; }
declare namespace JSX {
  interface IntrinsicElements { [k: string]: any }
  interface Element {}
  interface ElementChildrenAttribute { children: {} }
  interface IntrinsicAttributes { key?: any }
}
