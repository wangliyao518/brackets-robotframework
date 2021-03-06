/* 
*/

/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50, regexp: true */
/*global define, brackets, $ */


define(function (require, exports, module) {
    'use strict';
  
    var CommandManager  = brackets.getModule("command/CommandManager");
    var Dialogs         = brackets.getModule("widgets/Dialogs");
    var DefaultDialogs  = brackets.getModule("widgets/DefaultDialogs");
    var LanguageManager = brackets.getModule("language/LanguageManager");
    var AppInit         = brackets.getModule("utils/AppInit");
    var CodeHintManager = brackets.getModule("editor/CodeHintManager");
    var PreferencesManager = brackets.getModule("preferences/PreferencesManager");
    var EditorManager   = brackets.getModule("editor/EditorManager");
    var MainViewManager = brackets.getModule("view/MainViewManager");
    var FindInFilesUI   = brackets.getModule("search/FindInFilesUI");

    var Menus           = brackets.getModule("command/Menus");
    var CodeInspection  = brackets.getModule("language/CodeInspection");

    var robot           = require("./robot");
    var argfile         = require("./argfile_mode");
    var hints           = require("./hints");
    var inlinedocs      = require("./inlinedocs");
    var search_keywords = require("./search_keywords");
    var runner          = require("./runner");
    var linter          = require("./lint");
    var rangefinder     = require("./rangefinder");
    var settings_dialog = require("./settings_dialog");

    var FIND_DEFINITION_ID  = "bryanoakley.find-definition";
    var TOGGLE_KEYWORDS_ID  = "bryanoakley.show-robot-keywords";
    var TOGGLE_RUNNER_ID    = "bryanoakley.show-robot-runner";
    var SELECT_STATEMENT_ID = "bryanoakley.select-statement";
    var EDIT_SETTINGS_ID    = "bryanoakley.edit-robot-preferences";
    var RUN_ID              = "bryanoakley.run";

    var robotMenu;

    var _prefs = PreferencesManager.getExtensionPrefs("robotframework");
    _prefs.definePreference("hub-url", "string", "http://localhost:7070");
    _prefs.definePreference("run-command", "string", "pybot --suite %SUITE tests");
    _prefs.definePreference("rflint-command", "string", "rflint");

    function initializeExtraStyles() {
        // I want pipes to be fairly faint; instead of using a color,
        // we'll make it really opaque.  This seems to work fairly well,
        // though I need more real-world testing. Maybe this should be
        // a preference?
        var node = document.createElement("style");
        node.innerHTML = ".cm-cell-separator {opacity: 0.3;}";
        document.body.appendChild(node);
    }

    function onClick(cm, e) {
        // handle triple-click events; this is how we begin support for
        // selecting cell contents with a triple-click
        var editor = EditorManager.getCurrentFullEditor();
        if (editor && editor.getModeForDocument() === "robot") {
            robot.onClick(cm, e)
        }
    }

    function initializeUI() {
        // This is not the right way to do this. For exmaple, if you 
        // open a file in a different mode then switch to robot mode,
        // this code won't fire. What's the right way to do this?


        // do some mode-specific initialization that can only be done after 
        // an editor has been instantiated.
        var editor = EditorManager.getCurrentFullEditor();

        if (editor && editor.getModeForDocument() === "robot") {
            var cm = editor ? editor._codeMirror : null;
            if (cm && (typeof editor.initialized === 'undefined' || !editor.initialized)) {
                // I should probably be using the brackets manager APIs to
                // do this...
                var extraKeys = cm.getOption('extraKeys');
                extraKeys.Tab = robot.onTab;
                cm.addOverlay(robot.overlayMode());

                // this is so we can do something special for triple-clicks
                cm.on("mousedown", onClick);
            }
        }
    }

    // Create a menu just for this extension. In general, extensions
    // should avoid such schenanigans, but I need a user-visible place
    // to hang some features and keyboard shortcuts.
    function initializeMenu() {
        robotMenu = Menus.addMenu("Robot", "robot", Menus.BEFORE, Menus.AppMenuBar.HELP_MENU);

        CommandManager.register("Select current statement", SELECT_STATEMENT_ID, 
                                robot.selectCurrentStatement);
        CommandManager.register("Show keyword search window", TOGGLE_KEYWORDS_ID, 
                                search_keywords.toggleKeywordSearch);
        CommandManager.register("Show runner window", TOGGLE_RUNNER_ID, 
                                runner.toggleRunner);
        CommandManager.register("Run test suite", RUN_ID,
                                runner.runSuite)
        CommandManager.register("Robot Settings ...", EDIT_SETTINGS_ID,
                                settings_dialog.showSettingsDialog);
        CommandManager.register("Find Definition ...", FIND_DEFINITION_ID,
                                findDefinition);
        robotMenu.addMenuItem(FIND_DEFINITION_ID,
                              [{key: "Ctrl-Alt-F"},
                               {key: "Ctrl-Alt-F", platform: "mac"},
                              ]);
        robotMenu.addMenuItem(SELECT_STATEMENT_ID, 
                             [{key: "Ctrl-\\"}, 
                              {key: "Ctrl-\\", platform: "mac"}]);
        
        robotMenu.addMenuDivider();

        robotMenu.addMenuItem(RUN_ID,
                              [{key: "Ctrl-R"},
                               {key: "Ctrl-R", platform: "mac"},
                              ]);

        robotMenu.addMenuDivider();

        robotMenu.addMenuItem(TOGGLE_KEYWORDS_ID, 
                              [{key: "Ctrl-Alt-\\"}, 
                               {key: "Ctrl-Alt-\\", platform: "mac" }]);
        robotMenu.addMenuItem(TOGGLE_RUNNER_ID,
                              [{key: "Alt-R"},
                               {key: "Alt-R", platform: "mac"},
                              ]);

        robotMenu.addMenuDivider();
        robotMenu.addMenuItem(EDIT_SETTINGS_ID);

    }

    /**
       Use the "Find In File" feature to find where a keyword is
       defined. This is a quick and dirty hack that simply looks
       for the keyword name at the beginning of a line, and preceded
       by either a space or a pipe and space. 

       Perhaps in the future this can pull data from robotframework-hub.
     */
    function findDefinition() {

        var editor = EditorManager.getCurrentFullEditor()
        var selection = editor.getSelectedText().trim();

        if (selection === "") {
            // should we display a warning dialog?
            Dialogs.showModalDialog(
                DefaultDialogs.DIALOG_ID_INFO,
                "Find Definition..",
                "To use this feature, first highlight a keyword name.");
            return;
        }
        
        // escape any regex characters in the selection
        selection = selection.replace(/[.?*+^$[\]\\(){}|-]/g, "\\$&");

        // build a pattern that matches either '^| foo' or '^\s*foo'
        var pattern = "^(\\|\\s+|\\s*)" + selection;

        var queryInfo = {
            query: pattern, 
            isCaseSensitive: false,
            isRegexp: true
        };

        // I get no notification if it doesn't find anything. That
        // sucks. 
        FindInFilesUI.searchAndShowResults(queryInfo);
    }

    function initializeCodemirror() {
        // All the codemirror stuff to make the mode work...
        var cm = brackets.getModule("thirdparty/CodeMirror2/lib/codemirror");
        cm.defineMode("robot_argfile", argfile.argfileMode);
        cm.defineMIME("text/x-robot-args", "argfile");
        LanguageManager.defineLanguage("robot_argfile", {
            name: "robot_argfile",
            mode: "robot_argfile",
            fileExtensions: ["args"],
            lineComment: ["#"]
        });

        // the core robot mode
        cm.defineMode("robot-variable", robot.overlayMode);
        cm.defineMode("robot", robot.baseMode);
        cm.defineMIME("text/x-robot", "robot");
        cm.registerHelper("fold", "robot", rangefinder.rangeFinder);

        LanguageManager.defineLanguage("robot", {
            name: "Robot",
            mode: "robot",
            fileExtensions: ["robot"],
            lineComment: ["#"]
        });
    }
    
    AppInit.appReady(function () {
        MainViewManager.on("currentFileChange", initializeUI);
        // the event is *not* fired for the initial document, so 
        // we have to call it directly at startup.
        // N.B. this used to be true prior to brackets 1.0; maybe
        // it's not true now? I need to do more testing...
//        initializeUI();

    });

    initializeExtraStyles();
    initializeMenu();
    initializeCodemirror();

    search_keywords.init();
    runner.init();
    linter.init();

    CodeHintManager.registerHintProvider(new hints.HintProvider(), ["robot"], 1);
    EditorManager.registerInlineDocsProvider(inlinedocs.inlineDocsProvider);
    CodeInspection.register("robot", {
        name: "robotframework-lint",
        scanFileAsync: linter.handleLintRequest
    });

});
