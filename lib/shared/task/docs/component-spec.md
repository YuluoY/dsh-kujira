# Task detail tabs

The generic tabs component selects one category; the task panel supplies the category labels, counts and content. Task status, goal, attention and progress remain above the tabs.

API: `items` contains `{id,label,count,attention?,content}`; `value` and `onChange` control selection. An optional `scrollMemory` ref retains per-category scroll positions when entering and returning from result details. The task panel owns list expansion limits so lazy mounting does not discard them.

Categories without data are omitted. An existing selection survives ordinary updates; removing it selects the first available category. No categories means no tab strip. Loading and connection errors remain the task panel's responsibility.

The strip uses the [WAI-ARIA tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/): one tab stop, arrow-key wrapping, Home/End, labelled panels, and automatic activation for already available local content. Up/Down keep their native scrolling behavior. Long translations scroll horizontally without wrapping. Only the selected category mounts its content.

Structure, semantic colors and motion use the existing panel tokens in `task-tabs.css`. The indicator moves for 180 ms and content fades for 130 ms; reduced-motion mode suppresses both. Touch tabs are at least 44 px high. The surrounding panel stays content-sized with a viewport-bounded maximum height.

Validation: keyboard and selection tests, ARIA relationships, lazy mounting, live updates, long labels and lists, narrow viewports, scroll restoration and result navigation.
