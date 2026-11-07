# Third-Party Notices

BackOnTrack AI was started from
[shadcn-ui/chatbot-template](https://github.com/shadcn-ui/chatbot-template)
at commit `4106041b1bc9bab44e81ffd2764aa2b6f100e2b0`. The project configuration
and the UI primitives in `components/ui/` come from that template. Its license
is reproduced below as it requires.

```text
MIT License

Copyright (c) 2026 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Components added for the recovery workspace

| Project | Use | License |
| --- | --- | --- |
| [FullCalendar](https://github.com/fullcalendar/fullcalendar) standard packages (`@fullcalendar/core`, `react`, `daygrid`, `timegrid`, `multimonth`, `interaction`) | Calendar, as an npm dependency. No premium packages. | MIT, Copyright (c) 2021 Adam Shaw |
| [dnd-kit](https://github.com/clauderic/dnd-kit) (`@dnd-kit/core`) | Kanban drag and drop, as an npm dependency | MIT, Copyright (c) 2021, Claudéric Demers |
| [axe-core](https://github.com/dequelabs/axe-core) | Accessibility tests only. Not shipped in the app. | MPL-2.0 |

## Components added for task execution

| Project | Use | License |
| --- | --- | --- |
| [Tiptap](https://github.com/ueberdosis/tiptap) (`@tiptap/core`, `react`, `pm`, `starter-kit`, `extension-list`, `extensions`, `markdown`) | Working document editor, as npm dependencies | MIT |
| [PDF.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`) | Reading PDF text in the browser, as an npm dependency | Apache-2.0, Copyright Mozilla and the PDF.js contributors. The license is included in the package. |

## Projects reviewed, with no code copied

| Project | License found on 2026-11-05 | Outcome |
| --- | --- | --- |
| [Georgegriff/react-dnd-kit-tailwind-shadcn-ui](https://github.com/Georgegriff/react-dnd-kit-tailwind-shadcn-ui) | MIT, Copyright (c) 2023 George Griffiths | Its approach to keyboard sensors and screen-reader announcements informed the board, which was written separately for this app's data. |
| [hunghg255/reactjs-tiptap-editor](https://github.com/hunghg255/reactjs-tiptap-editor) | MIT | Not used. It brings its own interface, so core Tiptap fits the app's design with less code. |
| [kcsujeet/ilamy-calendar](https://github.com/kcsujeet/ilamy-calendar) | MIT | Not used. The brief said not to rebuild the calendar, so FullCalendar stays. |
| [natuomi/pomodoro](https://github.com/natuomi/pomodoro) | MIT | Not used. It counts `setInterval` ticks, and this project needs wall-clock timing. |
| [ZainnQureshii/flowtask](https://github.com/ZainnQureshii/flowtask) | No LICENSE file, and none detected by GitHub, although its README says "MIT" | Not used. Without an explicit license file, no code was taken from it. |
| [albertkupperdev/sapling](https://github.com/albertkupperdev/sapling) | None | Not used. |

npm dependencies keep their own licenses, which are listed in their packages
under `node_modules/` after installation.
