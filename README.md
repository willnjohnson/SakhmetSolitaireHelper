# Sakhmet Solitaire Helper

This GreaseMonkey script enhances the Sakhmet Solitaire game on Neopets by providing visual cues for playable cards and automated gameplay assistance, helping players identify optimal moves more easily.

**Note:** Should be functional now (this one took FOREVER to implement, especially cycle detection). Please report any problems encountered under Issues.

## Features

* **Dynamic Card Highlighting:**
    * Script looks for Source Card -> Destination Card
    * Source Card will be initially highlighted magenta
    * Destination Card will be highlighted if Source Card is selected
    * Different highlight colors for different types of moves: (magenta = src), (green = dst), (cyan = draw)

* **Automated Gameplay:**
    * Full autoplayer functionality with AI-driven move suggestions
    * Variable delays between actions to avoid bot detection (can be adjusted)

## Installation

This script requires a user script manager like Tampermonkey or Greasemonkey.

1. **Install a User Script Manager:**
   - [Tampermonkey](https://www.tampermonkey.net/) (recommended)
   - [Greasemonkey](https://www.greasespot.net/)

2. **Create a New User Script:**
   - Click on the Greasemonkey/Tampermonkey icon in your browser's toolbar
   - Select "Create a new script..." (or "New script")

3. **Paste the Script:**
   - Delete any existing code in the new script editor
   - Copy the entire code from the `Sakhmet Solitaire Helper` script and paste it into the editor

4. **Save the Script:**
   - Save the script (usually `Ctrl+S` or `File > Save`)

## Usage

1. **Navigate to the Sakhmet Solitaire game page on Neopets**
2. **The script will automatically run and apply highlights to playable cards**
3. **Observe the magenta/green/cyan outlines to guide your moves**
4. **When you click a card in the tableau, it will be highlighted magenta, and any valid destination cards will be highlighted green**
5. **Cards highlighted in cyan indicate draw**
6. **For automated play:** The script will automatically make moves (please adjust delays as you see fit)

## Configuration

The script includes configurable delay ranges to make automated gameplay less predictable:

- **Draw card:** 500-700ms
- **Initial card selection:** 800-900ms
- **Card movement:** 600-700ms
- **Collect winnings:** 1400-1800ms
- **Pre/post-game screens:** 700-900ms

## Compatibility

* **Browser:** Compatible with modern web browsers (Chrome, Firefox, Edge, Opera) using a user script manager
* **Game:** Designed specifically for the Neopets Sakhmet Solitaire game

## Contributing

Contributions are welcome! If you have suggestions for improvements, bug fixes, or new features, feel free to open an issue or submit a pull request.

## License

This project is open-source and available under the MIT License.

**Disclaimer:** "Neopets" is a registered trademark of Neopets, Inc. This script is an unofficial fan-made helper and is not affiliated with or endorsed by Neopets, Inc.
