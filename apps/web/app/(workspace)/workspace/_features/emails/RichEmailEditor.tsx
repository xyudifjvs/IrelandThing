"use client";

import { useEffect, useRef, useState } from "react";
import {
  EditorContent,
  useEditor,
  Node as TiptapNode,
  nodeInputRule,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import {
  editorEmailHtml,
  MAX_SIGNATURE_IMAGE_BYTES,
  validSignatureImage,
} from "../../../../../../../packages/communications/src/email-body";
import { useData } from "../../_components/data";
import { cleanEditorHtml } from "./email-html-client";
import s from "./RichEmailEditor.module.css";

// A field is one inline token: formatting cannot split its braces or key.
const MergeToken = TiptapNode.create({
  name: "mergeToken",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { key: { default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-merge-field]",
        getAttrs: (el) => ({ key: el.getAttribute("data-merge-field") }),
      },
    ];
  },
  renderHTML({ node }) {
    return [
      "span",
      { "data-merge-field": node.attrs.key },
      `{{${node.attrs.key}}}`,
    ];
  },
  renderText({ node }) {
    return `{{${node.attrs.key}}}`;
  },
  addInputRules() {
    return [
      nodeInputRule({
        find: /\{\{([a-zA-Z0-9_]+)\}\}$/,
        type: this.type,
        getAttributes: (match) => ({ key: match[1] }),
      }),
    ];
  },
});
const SignatureImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: 240,
        parseHTML: (el) => el.getAttribute("width"),
        renderHTML: (attrs) => ({ width: attrs.width }),
      },
    };
  },
});

export function RichEmailEditor({
  value,
  defaultValue = "",
  format,
  name,
  label,
  onChange,
  disabled = false,
  signature = false,
}: {
  value?: string;
  defaultValue?: string;
  format?: string | null;
  name?: string;
  label: string;
  onChange?: (html: string) => void;
  disabled?: boolean;
  signature?: boolean;
}) {
  const initial = useRef(editorEmailHtml(value ?? defaultValue, format));
  const [savedHtml, setSavedHtml] = useState(initial.current);
  const [error, setError] = useState("");
  const [linkOpen, setLinkOpen] = useState(false),
    [url, setUrl] = useState("");
  const [alt, setAlt] = useState("Signature");
  const [field, setField] = useState("");
  const latest = useRef(onChange);
  latest.current = onChange;
  const lastEmitted = useRef<string | undefined>(undefined);
  const fields = useData<{ definitions: { key: string; label: string }[] }>(
    signature ? null : "/api/v1/communications/field-configuration",
  );
  const custom = useData<{ key: string; label: string }[]>(
    signature ? null : "/api/v1/communications/custom-merge-fields",
  );
  const choices = [
    ...new Map(
      [...(fields.data?.definitions ?? []), ...(custom.data ?? [])].map((f) => [
        f.key,
        f,
      ]),
    ).values(),
  ];
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({
        blockquote: false,
        code: false,
        codeBlock: false,
        strike: false,
        horizontalRule: false,
        heading: { levels: [2] },
        link: {
          openOnClick: false,
          autolink: false,
          protocols: ["mailto", "tel"],
          HTMLAttributes: { target: null, rel: null, class: null },
        },
      }),
      TextStyle,
      FontSize,
      MergeToken,
      SignatureImage.configure({ allowBase64: true, inline: true }),
    ],
    content:
      typeof window === "undefined"
        ? initial.current
        : cleanEditorHtml(initial.current),
    editable: !disabled,
    editorProps: {
      attributes: {
        class: s.editor,
        role: "textbox",
        "aria-label": label,
        "aria-multiline": "true",
      },
      transformPastedHTML: (html) => cleanEditorHtml(html, true),
    },
    onUpdate: ({ editor }) => {
      const html = editor.isEmpty ? "" : editor.getHTML();
      lastEmitted.current = html;
      setSavedHtml(html);
      latest.current?.(html);
    },
  });
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);
  useEffect(() => {
    if (!editor || value === undefined || value === lastEmitted.current) return;
    const html = editorEmailHtml(value, format);
    if (editor.getHTML() !== html)
      editor.commands.setContent(cleanEditorHtml(html), { emitUpdate: false });
    setSavedHtml(html);
    lastEmitted.current = value;
  }, [editor, value, format]);
  const button = (
    title: string,
    active: boolean,
    run: () => void,
    content: React.ReactNode = title,
  ) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled || !editor}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {content}
    </button>
  );
  async function image(file?: File) {
    if (!file || !editor) return;
    setError("");
    if (
      !["image/png", "image/jpeg"].includes(file.type) ||
      file.size > MAX_SIGNATURE_IMAGE_BYTES
    ) {
      setError("Choose a PNG or JPG signature image of 200 KB or less.");
      return;
    }
    try {
      const src = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      if (!validSignatureImage(src))
        throw new Error("Choose a valid PNG or JPG image.");
      editor
        .chain()
        .focus()
        .setImage({ src, alt: alt.trim() || "Signature" })
        .run();
    } catch {
      setError("Could not insert this image. Choose a valid PNG or JPG image.");
    }
  }
  return (
    <div className={s.frame}>
      {name && <input type="hidden" name={name} value={savedHtml} />}
      <div
        className={s.toolbar}
        role="group"
        aria-label={`${label} formatting`}
      >
        {button(
          "Bold",
          !!editor?.isActive("bold"),
          () => editor?.chain().focus().toggleBold().run(),
          <strong>B</strong>,
        )}
        {button(
          "Italic",
          !!editor?.isActive("italic"),
          () => editor?.chain().focus().toggleItalic().run(),
          <em>I</em>,
        )}
        {button(
          "Underline",
          !!editor?.isActive("underline"),
          () => editor?.chain().focus().toggleUnderline().run(),
          <u>U</u>,
        )}
        {button("Bulleted list", !!editor?.isActive("bulletList"), () =>
          editor?.chain().focus().toggleBulletList().run(),
        )}
        {button("Numbered list", !!editor?.isActive("orderedList"), () =>
          editor?.chain().focus().toggleOrderedList().run(),
        )}
        {button("Link", !!editor?.isActive("link"), () => {
          setUrl(editor?.getAttributes("link").href || "");
          setLinkOpen(!linkOpen);
        })}
        <select
          aria-label="Text size"
          disabled={!editor || disabled}
          value={
            editor?.isActive("heading")
              ? "heading"
              : editor?.getAttributes("textStyle").fontSize === "18px"
                ? "large"
                : "normal"
          }
          onChange={(e) => {
            const chain = editor?.chain().focus();
            if (!chain) return;
            if (e.target.value === "heading")
              chain.unsetFontSize().setHeading({ level: 2 }).run();
            else if (e.target.value === "large")
              chain.setParagraph().setFontSize("18px").run();
            else chain.setParagraph().unsetFontSize().run();
          }}
        >
          <option value="normal">Normal</option>
          <option value="large">Large</option>
          <option value="heading">Heading</option>
        </select>
        {button("Clear formatting", false, () =>
          editor?.chain().focus().unsetAllMarks().clearNodes().run(),
        )}
        {!signature && (
          <>
            <select
              aria-label="Merge field to insert"
              value={field}
              disabled={disabled}
              onChange={(e) => setField(e.target.value)}
            >
              <option value="">Choose a field</option>
              {choices.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label} — {f.key}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!field || !editor || disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() =>
                editor
                  ?.chain()
                  .focus()
                  .insertContent({
                    type: "mergeToken",
                    attrs: { key: field },
                    marks: (
                      editor.state.storedMarks ??
                      editor.state.selection.$from.marks()
                    ).map((mark) => mark.toJSON()),
                  })
                  .run()
              }
            >
              Insert field
            </button>
          </>
        )}
      </div>
      {linkOpen && (
        <div className={s.toolbar}>
          <input
            aria-label="Link URL"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (
                url &&
                (!/^(https?:\/\/|mailto:|tel:)/i.test(url) ||
                  /[{}\u0000-\u0020]/.test(url))
              ) {
                setError("Use an https://, http://, mailto: or tel: link.");
                return;
              }
              const chain = editor?.chain().focus().extendMarkRange("link");
              if (url) chain?.setLink({ href: url }).run();
              else chain?.unsetLink().run();
              setLinkOpen(false);
              setError("");
            }}
          >
            Apply link
          </button>
          <button type="button" onClick={() => setLinkOpen(false)}>
            Cancel
          </button>
        </div>
      )}
      <EditorContent editor={editor} />
      {signature && (
        <details className={s.imageSection}>
          <summary>Insert image</summary>
          <p>
            Upload a PNG or JPG of your signature (200 KB or less). It is
            embedded in the email.
          </p>
          <label>
            Image description
            <input
              value={alt}
              maxLength={160}
              onChange={(e) => setAlt(e.target.value)}
            />
          </label>
          <label>
            Choose signature image
            <input
              type="file"
              accept="image/png,image/jpeg"
              disabled={disabled}
              onChange={(e) => {
                void image(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <p>Select an image in the editor and press Backspace to remove it.</p>
        </details>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function RichEmailPreview({ html }: { html: string }) {
  const [clean, setClean] = useState("");
  useEffect(() => {
    setClean(cleanEditorHtml(html));
  }, [html]);
  return (
    <div className={s.preview} dangerouslySetInnerHTML={{ __html: clean }} />
  );
}
