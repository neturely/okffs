<!-- okffs:type=Fixed -->
- The org-level Issue Fields preview API (used for `list_issues` Priority/Effort and `create_issue` option lookup) is now retried up to 3 times with a short backoff on transient failures, making it far less likely to intermittently drop Priority/Effort. Permission errors (403/FORBIDDEN) are still reported immediately without retry (#137).
