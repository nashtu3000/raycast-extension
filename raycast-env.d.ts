/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `convert-to-markdown` command */
  export type ConvertToMarkdown = ExtensionPreferences & {}
  /** Preferences accessible in the `convert-to-plain-markdown` command */
  export type ConvertToPlainMarkdown = ExtensionPreferences & {}
  /** Preferences accessible in the `convert-markdown-to-richtext` command */
  export type ConvertMarkdownToRichtext = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `convert-to-markdown` command */
  export type ConvertToMarkdown = {}
  /** Arguments passed to the `convert-to-plain-markdown` command */
  export type ConvertToPlainMarkdown = {}
  /** Arguments passed to the `convert-markdown-to-richtext` command */
  export type ConvertMarkdownToRichtext = {}
}

