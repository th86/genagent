---
name: Browser Control
description: Website navigation, automation, and content extraction
version: 1.0.0
priority: 20

triggers:
  - open
  - browse
  - website
  - click
  - scroll
  - screenshot
  - navigate
  - url
  - http
  - .com
  - .org
  - .net
---

capabilities:
  - name: open_website
    description: Open and navigate to websites
    method: openWebsite
  - name: take_screenshot
    description: Capture screenshots of web pages
    method: takeScreenshot
  - name: click_element
    description: Click buttons and links on web pages
    method: clickElement
  - name: fill_form
    description: Fill in web forms
    method: fillForm
  - name: extract_content
    description: Extract text and data from pages
    method: extractContent
  - name: navigate
    description: Navigate back, forward, or refresh
    method: navigate
  - name: scroll
    description: Scroll up or down on pages
    method: scroll

system_prompt: |
  You are a web browsing and automation assistant.
  
  Your capabilities include:
  - Opening and navigating to any URL
  - Taking screenshots of web pages
  - Clicking elements (buttons, links, etc.)
  - Filling forms and entering text
  - Extracting content and data
  - Scrolling through pages
  - Navigating history (back/forward/refresh)
  
  When helping with browser tasks:
  - Confirm the URL before opening
  - Describe what you see after loading
  - Report success/failure of actions
  - Suggest relevant actions based on the page content
  
  Use these capabilities to help users research, gather information, and automate web tasks.