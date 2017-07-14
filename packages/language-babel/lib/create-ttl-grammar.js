'use strict';

/*global atom*/
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const CompositeDisposable = require('atom').CompositeDisposable;

// This Class is repsonsible for creating a new Tagged Template grammar
// on detection of a changed Tagged Template Configuration in the package settings
module.exports = class CreateTtlGrammar {

  constructor() {
    let observeConfig = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : false;
    this.disposable = new CompositeDisposable();
    this.configChangedTimer = null;
    this.TTL_GRAMMAR_NAME = 'language-babel-extension';
    this.TTL_SCOPENAME = `languagebabel.ttlextension`;

    if (observeConfig) {
      // look for changes in tagged template handlers
      this.disposable.add(atom.config.observe('language-babel.taggedTemplateGrammar', this.observeTtlConfig.bind(this, 10000)));
    }
  }

  destroy() {
    this.disposable.dispose();
  }

  // add new grammars to registry
  addGrammars(filename) {
    return new Promise((resolve, reject) => {
      atom.grammars.loadGrammar(filename, err => {
        if (err) {
          reject(new Error(`Unable to add Grammar to registry\n${ filename }`));
        } else resolve();
      });
    });
  }

  // Check if the grammar exists under this SHA256 file name
  // If not then remove all ttl grammars and create a new one
  // This returns a Promise that resolves  with a ttl filename
  // if a new grammar was created or rejects if a problem.
  createGrammar(_ref) {
    let ttlFilename = _ref.ttlFilename,
        ttlFilenameAbsolute = _ref.ttlFilenameAbsolute,
        grammarText = _ref.grammarText;

    return new Promise((resolve, reject) => {
      this.doesGrammarFileExist(ttlFilename).then(ifFileExists => {
        if (ifFileExists) {
          resolve();
        } else {
          this.removeGrammars();
          this.removeTtlLanguageFiles().then(() => this.createGrammarFile(ttlFilenameAbsolute, grammarText)).then(() => this.addGrammars(ttlFilenameAbsolute)).then(() => {
            atom.notifications.addInfo('language-babel', { detail: `Grammar created at \n${ ttlFilenameAbsolute }`, dismissable: true });
            resolve(ttlFilename);
          }).catch(err => {
            atom.notifications.addWarning('language-babel', { detail: `${ err.message }`, dismissable: true });
            reject(err);
          });
        }
      });
    });
  }

  // write the ttl grammar file for this config
  createGrammarFile(filename, text) {
    return new Promise((resolve, reject) => {
      fs.writeFile(filename, text, err => {
        if (err) reject(new Error(err));else resolve();
      });
    });
  }

  // create a Grammar file's JSON text
  createGrammarText() {
    return `{
  "name": "${ this.TTL_GRAMMAR_NAME }",
  "comment": "Auto generated Tag Extensions for language-babel",
  "comment": "Please do not edit this file directly",
  "scopeName": "${ this.TTL_SCOPENAME }",
  "fileTypes": [],
  "patterns": [
    ${ this.getTtlConfig().map(ttlString => this.createGrammarPatterns(ttlString)) }
  ]
}`;
  }

  // Create a grammar's pattern derived from a the tagged template string
  // in the form matchString:includeScope
  createGrammarPatterns(ttlString) {
    let lastColonIndex = ttlString.lastIndexOf(':');
    let matchString = ttlString.substring(0, lastColonIndex);
    let includeScope = ttlString.substring(lastColonIndex + 1);
    const isValidIncludeScope = /^([a-zA-Z]\w*\.?)*(\w#([a-zA-Z]\w*\.?)*)?\w$/.test(includeScope);
    const isQuotedMatchString = /^\".*\"$/.test(matchString);

    if (matchString.length < 1 || !isValidIncludeScope) {
      throw new Error(`Error in the Tagged Template Grammar String ${ ttlString }`);
    }

    if (isQuotedMatchString) {
      // Found a possible regexp in the form "regex" so strip the "
      matchString = matchString.substring(1, matchString.length - 1);
      try {
        this.onigurumaCheck(matchString);
        matchString = matchString.replace(/\\/g, "\\\\"); // \ to \\
        matchString = matchString.replace(/\\\\["]/g, "\\\\\\\""); // \\" to \\
      } catch (err) {
        throw new Error(`You entered an badly formed RegExp in the Tagged Template Grammar settings.\n${ matchString }\n${ err }`);
      }
    } else if (/"/g.test(matchString)) {
      throw new Error(`Bad literal string in the Tagged Template Grammar settings.\n${ matchString }`);
    } else {
      // User entered a literal string which may contain chars that a special inside a regex.
      // Escape any special chars e.g. '/** @html */' -> '\/\*\* @html \*\/'
      // The string stored by Atom in the config has the \\ already escaped.
      const escapeStringRegExp = /[|{}()[\]^$+*?.]/g;
      const preEscapedSlash = /\\/g;
      matchString = matchString.replace(preEscapedSlash, '\\\\\\\\');
      matchString = matchString.replace(escapeStringRegExp, '\\\\$&');
    }

    return `{
      "contentName": "${ includeScope.match(/^[^#]*/)[0] }",
      "begin": "\\\\s*+(${ matchString })\\\\s*(\`)",
      "beginCaptures": {
        "1": { "name": "entity.name.tag.js" },
        "2": { "name": "punctuation.definition.quasi.begin.js" }
      },
      "end": "\\\\s*(?<=[^\\\\\\\\]\\\\\\\\\\\\\\\\|[^\\\\\\\\]|^\\\\\\\\\\\\\\\\|^)((\`))",
      "endCaptures": {
        "1": { "name": "punctuation.definition.quasi.end.js" }
      },
      "patterns": [
        { "include": "source.js.jsx#literal-quasi-embedded" },
        { "include": "${ includeScope }" }
      ]
    }`;
  }

  // checks a ttl grammar filename exists
  // returns a Promise that resolves to true if ttlFileName exists
  doesGrammarFileExist(ttlFilename) {
    return new Promise(resolve => {
      fs.access(this.makeTtlGrammarFilenameAbsoulute(ttlFilename), fs.F_OK, err => {
        err ? resolve(false) : resolve(true);
      });
    });
  }

  // get full path to the language-babel grammar file dir
  getGrammarPath() {
    return path.normalize(path.resolve(atom.packages.loadedPackages['language-babel'].path, './grammars'));
  }

  // get an array of all language-babel grammar files
  getGrammarFiles() {
    return new Promise((resolve, reject) => {
      fs.readdir(this.getGrammarPath(), (err, data) => {
        if (err) reject(new Error(err));else {
          resolve(data);
        }
      });
    });
  }

  // read configurations for tagged templates
  getTtlConfig() {
    return atom.config.get('language-babel').taggedTemplateGrammar;
  }

  // get an array of grammar tagged template extension filenames
  getTtlGrammarFiles() {
    return this.getGrammarFiles().then(dirFiles => dirFiles.filter(function (filename) {
      return (/^ttl-/.test(filename)
      );
    }));
  }

  // generate a SHA256 for some text
  generateTtlSHA256(stringToHash) {
    let hash = crypto.createHash('sha256');
    hash.update(stringToHash);
    return hash.digest('hex');
  }

  // tagged template filename
  makeTtlGrammarFilename(hashString) {
    return `ttl-${ hashString }.json`;
  }

  // get a fully qualified filename
  makeTtlGrammarFilenameAbsoulute(ttlFilename) {
    return path.resolve(this.getGrammarPath(), ttlFilename);
  }

  // observe changes in the taggedTemplateGrammar config which take place
  // because observed config changes are fired as a user types them inside
  // settings we need to delay processing the array strings, until last char
  // entered was setTimeout seconds ago. parse tagged template configuration
  // and then create grammar and generate a SHA256 hash from the grammar
  observeTtlConfig(timeout) {
    if (this.configChangedTimer) clearTimeout(this.configChangedTimer);
    this.configChangedTimer = setTimeout(() => {
      try {
        const grammarText = this.createGrammarText();
        const hash = this.generateTtlSHA256(grammarText);
        const ttlFilename = this.makeTtlGrammarFilename(hash);
        const ttlFilenameAbsolute = this.makeTtlGrammarFilenameAbsoulute(ttlFilename);
        this.createGrammar({ ttlFilename, ttlFilenameAbsolute, grammarText });
      } catch (err) {
        atom.notifications.addWarning('language-babel', { detail: `${ err.message }`, dismissable: true });
      }
    }, timeout);
  }

  // validate a regex with a Oniguruma. This will throw if it fails the checks
  // This will return true if the check passes or false if no oniguruma was found
  onigurumaCheck(regex) {
    let isRegexValid = false;
    // We need to call oniguruma's constructor via this convoluted method as I can't include
    // the github/atom/node-oniguruma package as npm on Windows get node-gyp errors unless a
    // user has installed a compiler. Find Atom's Oniguruma and call the constructor.
    if (typeof atom.grammars.grammars === "object") {
      atom.grammars.grammars.every(obj => {
        if (obj.name === "Babel ES6 JavaScript") {
          let ref, ref1, ref2;
          if ((ref = obj.firstLineRegex) != null) {
            if ((ref1 = ref.scanner) != null) {
              if ((ref2 = ref1.__proto__) != null) {
                if (typeof ref2.constructor === "function") {
                  // now call new obj.firstLineRegex.scanner.__proto__.constructor([onigString]);
                  // to validate the regex
                  new ref2.constructor([regex]);
                  isRegexValid = true;
                }
              }
            }
          }
          return false;
        } else return true;
      });
    }
    return isRegexValid;
  }

  // Remove grammars before upodating
  removeGrammars() {
    atom.grammars.removeGrammarForScopeName(this.TTL_SCOPENAME);
  }

  // remove all language files in tagged template GrammarFiles array
  removeTtlLanguageFiles() {
    return this.getTtlGrammarFiles().then(ttlGrammarFiles => {
      for (let ttlGrammarFilename of ttlGrammarFiles) {
        let ttlGrammarFileAbsoulte = this.makeTtlGrammarFilenameAbsoulute(ttlGrammarFilename);
        fs.unlink(ttlGrammarFileAbsoulte);
      }
    });
  }
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImNyZWF0ZS10dGwtZ3JhbW1hci5qcyJdLCJuYW1lcyI6WyJjcnlwdG8iLCJyZXF1aXJlIiwiZnMiLCJwYXRoIiwiQ29tcG9zaXRlRGlzcG9zYWJsZSIsIm1vZHVsZSIsImV4cG9ydHMiLCJDcmVhdGVUdGxHcmFtbWFyIiwiY29uc3RydWN0b3IiLCJvYnNlcnZlQ29uZmlnIiwiZGlzcG9zYWJsZSIsImNvbmZpZ0NoYW5nZWRUaW1lciIsIlRUTF9HUkFNTUFSX05BTUUiLCJUVExfU0NPUEVOQU1FIiwiYWRkIiwiYXRvbSIsImNvbmZpZyIsIm9ic2VydmUiLCJvYnNlcnZlVHRsQ29uZmlnIiwiYmluZCIsImRlc3Ryb3kiLCJkaXNwb3NlIiwiYWRkR3JhbW1hcnMiLCJmaWxlbmFtZSIsIlByb21pc2UiLCJyZXNvbHZlIiwicmVqZWN0IiwiZ3JhbW1hcnMiLCJsb2FkR3JhbW1hciIsImVyciIsIkVycm9yIiwiY3JlYXRlR3JhbW1hciIsInR0bEZpbGVuYW1lIiwidHRsRmlsZW5hbWVBYnNvbHV0ZSIsImdyYW1tYXJUZXh0IiwiZG9lc0dyYW1tYXJGaWxlRXhpc3QiLCJ0aGVuIiwiaWZGaWxlRXhpc3RzIiwicmVtb3ZlR3JhbW1hcnMiLCJyZW1vdmVUdGxMYW5ndWFnZUZpbGVzIiwiY3JlYXRlR3JhbW1hckZpbGUiLCJub3RpZmljYXRpb25zIiwiYWRkSW5mbyIsImRldGFpbCIsImRpc21pc3NhYmxlIiwiY2F0Y2giLCJhZGRXYXJuaW5nIiwibWVzc2FnZSIsInRleHQiLCJ3cml0ZUZpbGUiLCJjcmVhdGVHcmFtbWFyVGV4dCIsImdldFR0bENvbmZpZyIsIm1hcCIsInR0bFN0cmluZyIsImNyZWF0ZUdyYW1tYXJQYXR0ZXJucyIsImxhc3RDb2xvbkluZGV4IiwibGFzdEluZGV4T2YiLCJtYXRjaFN0cmluZyIsInN1YnN0cmluZyIsImluY2x1ZGVTY29wZSIsImlzVmFsaWRJbmNsdWRlU2NvcGUiLCJ0ZXN0IiwiaXNRdW90ZWRNYXRjaFN0cmluZyIsImxlbmd0aCIsIm9uaWd1cnVtYUNoZWNrIiwicmVwbGFjZSIsImVzY2FwZVN0cmluZ1JlZ0V4cCIsInByZUVzY2FwZWRTbGFzaCIsIm1hdGNoIiwiYWNjZXNzIiwibWFrZVR0bEdyYW1tYXJGaWxlbmFtZUFic291bHV0ZSIsIkZfT0siLCJnZXRHcmFtbWFyUGF0aCIsIm5vcm1hbGl6ZSIsInBhY2thZ2VzIiwibG9hZGVkUGFja2FnZXMiLCJnZXRHcmFtbWFyRmlsZXMiLCJyZWFkZGlyIiwiZGF0YSIsImdldCIsInRhZ2dlZFRlbXBsYXRlR3JhbW1hciIsImdldFR0bEdyYW1tYXJGaWxlcyIsImRpckZpbGVzIiwiZmlsdGVyIiwiZ2VuZXJhdGVUdGxTSEEyNTYiLCJzdHJpbmdUb0hhc2giLCJoYXNoIiwiY3JlYXRlSGFzaCIsInVwZGF0ZSIsImRpZ2VzdCIsIm1ha2VUdGxHcmFtbWFyRmlsZW5hbWUiLCJoYXNoU3RyaW5nIiwidGltZW91dCIsImNsZWFyVGltZW91dCIsInNldFRpbWVvdXQiLCJyZWdleCIsImlzUmVnZXhWYWxpZCIsImV2ZXJ5Iiwib2JqIiwibmFtZSIsInJlZiIsInJlZjEiLCJyZWYyIiwiZmlyc3RMaW5lUmVnZXgiLCJzY2FubmVyIiwiX19wcm90b19fIiwicmVtb3ZlR3JhbW1hckZvclNjb3BlTmFtZSIsInR0bEdyYW1tYXJGaWxlcyIsInR0bEdyYW1tYXJGaWxlbmFtZSIsInR0bEdyYW1tYXJGaWxlQWJzb3VsdGUiLCJ1bmxpbmsiXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQSxNQUFNQSxTQUFTQyxRQUFRLFFBQVIsQ0FBZjtBQUNBLE1BQU1DLEtBQUtELFFBQVEsSUFBUixDQUFYO0FBQ0EsTUFBTUUsT0FBT0YsUUFBUSxNQUFSLENBQWI7QUFDQSxNQUFNRyxzQkFBc0JILFFBQVEsTUFBUixFQUFnQkcsbUJBQTVDOztBQUVBO0FBQ0E7QUFDQUMsT0FBT0MsT0FBUCxHQUNBLE1BQU1DLGdCQUFOLENBQXVCOztBQU9yQkMsZ0JBQW1DO0FBQUEsUUFBdkJDLGFBQXVCLHVFQUFQLEtBQU87QUFBQSxTQUxuQ0MsVUFLbUMsR0FMdEIsSUFBSU4sbUJBQUosRUFLc0I7QUFBQSxTQUpuQ08sa0JBSW1DLEdBSmYsSUFJZTtBQUFBLFNBSG5DQyxnQkFHbUMsR0FIaEIsMEJBR2dCO0FBQUEsU0FGbkNDLGFBRW1DLEdBRmxCLDRCQUVrQjs7QUFDakMsUUFBSUosYUFBSixFQUFxQjtBQUNuQjtBQUNBLFdBQUtDLFVBQUwsQ0FBZ0JJLEdBQWhCLENBQW9CQyxLQUFLQyxNQUFMLENBQVlDLE9BQVosQ0FBb0Isc0NBQXBCLEVBQTRELEtBQUtDLGdCQUFMLENBQXNCQyxJQUF0QixDQUEyQixJQUEzQixFQUFpQyxLQUFqQyxDQUE1RCxDQUFwQjtBQUNEO0FBQ0Y7O0FBRURDLFlBQVU7QUFDUixTQUFLVixVQUFMLENBQWdCVyxPQUFoQjtBQUNEOztBQUVEO0FBQ0FDLGNBQVlDLFFBQVosRUFBc0I7QUFDcEIsV0FBTyxJQUFJQyxPQUFKLENBQVksQ0FBQ0MsT0FBRCxFQUFVQyxNQUFWLEtBQXFCO0FBQ3RDWCxXQUFLWSxRQUFMLENBQWNDLFdBQWQsQ0FBMEJMLFFBQTFCLEVBQXFDTSxHQUFELElBQVM7QUFDM0MsWUFBSUEsR0FBSixFQUFTO0FBQ1BILGlCQUFPLElBQUlJLEtBQUosQ0FBVyx1Q0FBcUNQLFFBQVMsR0FBekQsQ0FBUDtBQUNELFNBRkQsTUFHS0U7QUFDTixPQUxEO0FBTUQsS0FQTSxDQUFQO0FBU0Q7O0FBRUQ7QUFDQTtBQUNBO0FBQ0E7QUFDQU0sc0JBQStEO0FBQUEsUUFBaERDLFdBQWdELFFBQWhEQSxXQUFnRDtBQUFBLFFBQW5DQyxtQkFBbUMsUUFBbkNBLG1CQUFtQztBQUFBLFFBQWRDLFdBQWMsUUFBZEEsV0FBYzs7QUFDN0QsV0FBTyxJQUFJVixPQUFKLENBQVksQ0FBQ0MsT0FBRCxFQUFVQyxNQUFWLEtBQXFCO0FBQ3RDLFdBQUtTLG9CQUFMLENBQTBCSCxXQUExQixFQUNHSSxJQURILENBQ1NDLFlBQUQsSUFBa0I7QUFDdEIsWUFBSUEsWUFBSixFQUFrQjtBQUNoQlo7QUFDRCxTQUZELE1BR0s7QUFDSCxlQUFLYSxjQUFMO0FBQ0EsZUFBS0Msc0JBQUwsR0FDQ0gsSUFERCxDQUNNLE1BQU0sS0FBS0ksaUJBQUwsQ0FBdUJQLG1CQUF2QixFQUE0Q0MsV0FBNUMsQ0FEWixFQUVDRSxJQUZELENBRU0sTUFBTSxLQUFLZCxXQUFMLENBQWlCVyxtQkFBakIsQ0FGWixFQUdDRyxJQUhELENBR00sTUFBTTtBQUNWckIsaUJBQUswQixhQUFMLENBQW1CQyxPQUFuQixDQUEyQixnQkFBM0IsRUFBNkMsRUFBQ0MsUUFBUyx5QkFBdUJWLG1CQUFvQixHQUFyRCxFQUF1RFcsYUFBYSxJQUFwRSxFQUE3QztBQUNBbkIsb0JBQVFPLFdBQVI7QUFDRCxXQU5ELEVBT0NhLEtBUEQsQ0FPUWhCLEdBQUQsSUFBUztBQUNkZCxpQkFBSzBCLGFBQUwsQ0FBbUJLLFVBQW5CLENBQThCLGdCQUE5QixFQUFnRCxFQUFDSCxRQUFTLElBQUVkLElBQUlrQixPQUFRLEdBQXhCLEVBQTBCSCxhQUFhLElBQXZDLEVBQWhEO0FBQ0FsQixtQkFBT0csR0FBUDtBQUNELFdBVkQ7QUFXRDtBQUNGLE9BbkJIO0FBb0JELEtBckJNLENBQVA7QUFzQkQ7O0FBRUQ7QUFDQVcsb0JBQWtCakIsUUFBbEIsRUFBMkJ5QixJQUEzQixFQUFpQztBQUMvQixXQUFPLElBQUl4QixPQUFKLENBQVksQ0FBQ0MsT0FBRCxFQUFVQyxNQUFWLEtBQXFCO0FBQ3RDeEIsU0FBRytDLFNBQUgsQ0FBYTFCLFFBQWIsRUFBdUJ5QixJQUF2QixFQUE4Qm5CLEdBQUQsSUFBUztBQUNwQyxZQUFJQSxHQUFKLEVBQVNILE9BQU8sSUFBSUksS0FBSixDQUFVRCxHQUFWLENBQVAsRUFBVCxLQUNLSjtBQUNOLE9BSEQ7QUFJRCxLQUxNLENBQVA7QUFNRDs7QUFFRDtBQUNBeUIsc0JBQW9CO0FBQ2xCLFdBQVE7YUFBQSxDQUNDLEtBQUt0QyxnQkFBaUI7OztrQkFBQSxDQUdqQixLQUFLQyxhQUFjOzs7TUFBQSxDQUcvQixLQUFLc0MsWUFBTCxHQUFvQkMsR0FBcEIsQ0FBeUJDLFNBQUQsSUFBZ0IsS0FBS0MscUJBQUwsQ0FBMkJELFNBQTNCLENBQXhDLENBQWdGOztFQVBsRjtBQVVEOztBQUVEO0FBQ0E7QUFDQUMsd0JBQXNCRCxTQUF0QixFQUFpQztBQUMvQixRQUFJRSxpQkFBaUJGLFVBQVVHLFdBQVYsQ0FBc0IsR0FBdEIsQ0FBckI7QUFDQSxRQUFJQyxjQUFjSixVQUFVSyxTQUFWLENBQW9CLENBQXBCLEVBQXVCSCxjQUF2QixDQUFsQjtBQUNBLFFBQUlJLGVBQWVOLFVBQVVLLFNBQVYsQ0FBb0JILGlCQUFlLENBQW5DLENBQW5CO0FBQ0EsVUFBTUssc0JBQXNCLCtDQUErQ0MsSUFBL0MsQ0FBb0RGLFlBQXBELENBQTVCO0FBQ0EsVUFBTUcsc0JBQXNCLFdBQVdELElBQVgsQ0FBZ0JKLFdBQWhCLENBQTVCOztBQUVBLFFBQUlBLFlBQVlNLE1BQVosR0FBcUIsQ0FBckIsSUFBMEIsQ0FBQ0gsbUJBQS9CLEVBQW9EO0FBQ2xELFlBQU0sSUFBSTlCLEtBQUosQ0FBVyxnREFBOEN1QixTQUFVLEdBQW5FLENBQU47QUFDRDs7QUFFRCxRQUFLUyxtQkFBTCxFQUEyQjtBQUN6QjtBQUNBTCxvQkFBY0EsWUFBWUMsU0FBWixDQUFzQixDQUF0QixFQUF5QkQsWUFBWU0sTUFBWixHQUFvQixDQUE3QyxDQUFkO0FBQ0EsVUFBSTtBQUNGLGFBQUtDLGNBQUwsQ0FBb0JQLFdBQXBCO0FBQ0FBLHNCQUFjQSxZQUFZUSxPQUFaLENBQW9CLEtBQXBCLEVBQTBCLE1BQTFCLENBQWQsQ0FGRSxDQUUrQztBQUNqRFIsc0JBQWNBLFlBQVlRLE9BQVosQ0FBb0IsVUFBcEIsRUFBK0IsVUFBL0IsQ0FBZCxDQUhFLENBR3dEO0FBQzNELE9BSkQsQ0FLQSxPQUFPcEMsR0FBUCxFQUFZO0FBQ1YsY0FBTSxJQUFJQyxLQUFKLENBQVcsaUZBQStFMkIsV0FBWSxPQUFJNUIsR0FBSSxHQUE5RyxDQUFOO0FBQ0Q7QUFDRixLQVhELE1BWUssSUFBSyxLQUFLZ0MsSUFBTCxDQUFVSixXQUFWLENBQUwsRUFBNkI7QUFDaEMsWUFBTSxJQUFJM0IsS0FBSixDQUFXLGlFQUErRDJCLFdBQVksR0FBdEYsQ0FBTjtBQUNELEtBRkksTUFHQTtBQUNIO0FBQ0E7QUFDQTtBQUNBLFlBQU1TLHFCQUFxQixtQkFBM0I7QUFDQSxZQUFNQyxrQkFBa0IsS0FBeEI7QUFDQVYsb0JBQWNBLFlBQVlRLE9BQVosQ0FBb0JFLGVBQXBCLEVBQXFDLFVBQXJDLENBQWQ7QUFDQVYsb0JBQWNBLFlBQVlRLE9BQVosQ0FBb0JDLGtCQUFwQixFQUF3QyxRQUF4QyxDQUFkO0FBQ0Q7O0FBRUQsV0FBUTt3QkFBQSxDQUNZUCxhQUFhUyxLQUFiLENBQW1CLFFBQW5CLEVBQTZCLENBQTdCLENBQWdDOzBCQUFBLENBQzlCWCxXQUFZOzs7Ozs7Ozs7Ozt3QkFBQSxDQVdkRSxZQUFhOztNQWJqQztBQWdCRDs7QUFFRDtBQUNBO0FBQ0F4Qix1QkFBcUJILFdBQXJCLEVBQWtDO0FBQ2hDLFdBQU8sSUFBSVIsT0FBSixDQUFhQyxPQUFELElBQWE7QUFDOUJ2QixTQUFHbUUsTUFBSCxDQUFVLEtBQUtDLCtCQUFMLENBQXFDdEMsV0FBckMsQ0FBVixFQUE2RDlCLEdBQUdxRSxJQUFoRSxFQUF1RTFDLEdBQUQsSUFBUztBQUM3RUEsY0FBTUosUUFBUSxLQUFSLENBQU4sR0FBc0JBLFFBQVEsSUFBUixDQUF0QjtBQUNELE9BRkQ7QUFHRCxLQUpNLENBQVA7QUFLRDs7QUFFRDtBQUNBK0MsbUJBQWlCO0FBQ2YsV0FBT3JFLEtBQUtzRSxTQUFMLENBQ0x0RSxLQUFLc0IsT0FBTCxDQUFhVixLQUFLMkQsUUFBTCxDQUFjQyxjQUFkLENBQTZCLGdCQUE3QixFQUErQ3hFLElBQTVELEVBQWtFLFlBQWxFLENBREssQ0FBUDtBQUdEOztBQUVEO0FBQ0F5RSxvQkFBa0I7QUFDaEIsV0FBTyxJQUFJcEQsT0FBSixDQUFZLENBQUNDLE9BQUQsRUFBU0MsTUFBVCxLQUFvQjtBQUNyQ3hCLFNBQUcyRSxPQUFILENBQVcsS0FBS0wsY0FBTCxFQUFYLEVBQWlDLENBQUMzQyxHQUFELEVBQU1pRCxJQUFOLEtBQWU7QUFDOUMsWUFBSWpELEdBQUosRUFBU0gsT0FBTyxJQUFJSSxLQUFKLENBQVVELEdBQVYsQ0FBUCxFQUFULEtBQ0s7QUFDSEosa0JBQVFxRCxJQUFSO0FBQ0Q7QUFDRixPQUxEO0FBTUQsS0FQTSxDQUFQO0FBUUQ7O0FBRUQ7QUFDQTNCLGlCQUFlO0FBQ2IsV0FBT3BDLEtBQUtDLE1BQUwsQ0FBWStELEdBQVosQ0FBZ0IsZ0JBQWhCLEVBQWtDQyxxQkFBekM7QUFDRDs7QUFFRDtBQUNBQyx1QkFBcUI7QUFDbkIsV0FBTyxLQUFLTCxlQUFMLEdBQXVCeEMsSUFBdkIsQ0FBNEI4QyxZQUFZQSxTQUFTQyxNQUFULENBQWdCLFVBQVM1RCxRQUFULEVBQW1CO0FBQ2hGLGFBQU8sU0FBUXNDLElBQVIsQ0FBYXRDLFFBQWI7QUFBUDtBQUNELEtBRjhDLENBQXhDLENBQVA7QUFHRDs7QUFFRDtBQUNBNkQsb0JBQWtCQyxZQUFsQixFQUFnQztBQUM5QixRQUFJQyxPQUFPdEYsT0FBT3VGLFVBQVAsQ0FBa0IsUUFBbEIsQ0FBWDtBQUNBRCxTQUFLRSxNQUFMLENBQVlILFlBQVo7QUFDQSxXQUFPQyxLQUFLRyxNQUFMLENBQVksS0FBWixDQUFQO0FBQ0Q7O0FBRUQ7QUFDQUMseUJBQXVCQyxVQUF2QixFQUFtQztBQUNqQyxXQUFRLFFBQU1BLFVBQVcsUUFBekI7QUFDRDs7QUFFRDtBQUNBckIsa0NBQWdDdEMsV0FBaEMsRUFBNkM7QUFDM0MsV0FBTzdCLEtBQUtzQixPQUFMLENBQWEsS0FBSytDLGNBQUwsRUFBYixFQUFvQ3hDLFdBQXBDLENBQVA7QUFDRDs7QUFHRDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0FkLG1CQUFpQjBFLE9BQWpCLEVBQTBCO0FBQ3hCLFFBQUksS0FBS2pGLGtCQUFULEVBQTZCa0YsYUFBYSxLQUFLbEYsa0JBQWxCO0FBQzdCLFNBQUtBLGtCQUFMLEdBQTBCbUYsV0FBVyxNQUFNO0FBQ3pDLFVBQUk7QUFDRixjQUFNNUQsY0FBYyxLQUFLZ0IsaUJBQUwsRUFBcEI7QUFDQSxjQUFNb0MsT0FBTyxLQUFLRixpQkFBTCxDQUF1QmxELFdBQXZCLENBQWI7QUFDQSxjQUFNRixjQUFjLEtBQUswRCxzQkFBTCxDQUE0QkosSUFBNUIsQ0FBcEI7QUFDQSxjQUFNckQsc0JBQXNCLEtBQUtxQywrQkFBTCxDQUFxQ3RDLFdBQXJDLENBQTVCO0FBQ0EsYUFBS0QsYUFBTCxDQUFtQixFQUFDQyxXQUFELEVBQWNDLG1CQUFkLEVBQW1DQyxXQUFuQyxFQUFuQjtBQUNELE9BTkQsQ0FPQSxPQUFNTCxHQUFOLEVBQVc7QUFDVGQsYUFBSzBCLGFBQUwsQ0FBbUJLLFVBQW5CLENBQThCLGdCQUE5QixFQUFnRCxFQUFDSCxRQUFTLElBQUVkLElBQUlrQixPQUFRLEdBQXhCLEVBQTBCSCxhQUFhLElBQXZDLEVBQWhEO0FBQ0Q7QUFDRixLQVh5QixFQVd2QmdELE9BWHVCLENBQTFCO0FBWUQ7O0FBRUQ7QUFDQTtBQUNBNUIsaUJBQWUrQixLQUFmLEVBQXNCO0FBQ3BCLFFBQUlDLGVBQWUsS0FBbkI7QUFDQTtBQUNBO0FBQ0E7QUFDQSxRQUFJLE9BQU9qRixLQUFLWSxRQUFMLENBQWNBLFFBQXJCLEtBQWtDLFFBQXRDLEVBQWdEO0FBQzlDWixXQUFLWSxRQUFMLENBQWNBLFFBQWQsQ0FBdUJzRSxLQUF2QixDQUE4QkMsR0FBRCxJQUFTO0FBQ3BDLFlBQUlBLElBQUlDLElBQUosS0FBYSxzQkFBakIsRUFBeUM7QUFDdkMsY0FBSUMsR0FBSixFQUFTQyxJQUFULEVBQWVDLElBQWY7QUFDQSxjQUFJLENBQUNGLE1BQU1GLElBQUlLLGNBQVgsS0FBOEIsSUFBbEMsRUFBd0M7QUFDdEMsZ0JBQUksQ0FBQ0YsT0FBT0QsSUFBSUksT0FBWixLQUF3QixJQUE1QixFQUFrQztBQUNoQyxrQkFBSSxDQUFDRixPQUFPRCxLQUFLSSxTQUFiLEtBQTJCLElBQS9CLEVBQXFDO0FBQ25DLG9CQUFJLE9BQU9ILEtBQUs5RixXQUFaLEtBQTRCLFVBQWhDLEVBQTRDO0FBQzFDO0FBQ0E7QUFDQSxzQkFBSThGLEtBQUs5RixXQUFULENBQXFCLENBQUN1RixLQUFELENBQXJCO0FBQ0FDLGlDQUFlLElBQWY7QUFDRDtBQUNGO0FBQ0Y7QUFDRjtBQUNELGlCQUFPLEtBQVA7QUFDRCxTQWZELE1BZ0JLLE9BQU8sSUFBUDtBQUNOLE9BbEJEO0FBbUJEO0FBQ0QsV0FBT0EsWUFBUDtBQUNEOztBQUVEO0FBQ0ExRCxtQkFBaUI7QUFDZnZCLFNBQUtZLFFBQUwsQ0FBYytFLHlCQUFkLENBQXdDLEtBQUs3RixhQUE3QztBQUNEOztBQUVEO0FBQ0EwQiwyQkFBeUI7QUFDdkIsV0FBTyxLQUFLMEMsa0JBQUwsR0FBMEI3QyxJQUExQixDQUFnQ3VFLGVBQUQsSUFBcUI7QUFDekQsV0FBSyxJQUFJQyxrQkFBVCxJQUErQkQsZUFBL0IsRUFBZ0Q7QUFDOUMsWUFBSUUseUJBQXlCLEtBQUt2QywrQkFBTCxDQUFxQ3NDLGtCQUFyQyxDQUE3QjtBQUNBMUcsV0FBRzRHLE1BQUgsQ0FBVUQsc0JBQVY7QUFDRDtBQUNGLEtBTE0sQ0FBUDtBQU9EO0FBelFvQixDQUR2QiIsImZpbGUiOiJjcmVhdGUtdHRsLWdyYW1tYXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyIvKmdsb2JhbCBhdG9tKi9cclxuY29uc3QgY3J5cHRvID0gcmVxdWlyZSgnY3J5cHRvJyk7XHJcbmNvbnN0IGZzID0gcmVxdWlyZSgnZnMnKTtcclxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuY29uc3QgQ29tcG9zaXRlRGlzcG9zYWJsZSA9IHJlcXVpcmUoJ2F0b20nKS5Db21wb3NpdGVEaXNwb3NhYmxlO1xyXG5cclxuLy8gVGhpcyBDbGFzcyBpcyByZXBzb25zaWJsZSBmb3IgY3JlYXRpbmcgYSBuZXcgVGFnZ2VkIFRlbXBsYXRlIGdyYW1tYXJcclxuLy8gb24gZGV0ZWN0aW9uIG9mIGEgY2hhbmdlZCBUYWdnZWQgVGVtcGxhdGUgQ29uZmlndXJhdGlvbiBpbiB0aGUgcGFja2FnZSBzZXR0aW5nc1xyXG5tb2R1bGUuZXhwb3J0cyA9XHJcbmNsYXNzIENyZWF0ZVR0bEdyYW1tYXIge1xyXG5cclxuICBkaXNwb3NhYmxlID0gbmV3IENvbXBvc2l0ZURpc3Bvc2FibGUoKTtcclxuICBjb25maWdDaGFuZ2VkVGltZXI9IG51bGw7XHJcbiAgVFRMX0dSQU1NQVJfTkFNRSA9ICdsYW5ndWFnZS1iYWJlbC1leHRlbnNpb24nO1xyXG4gIFRUTF9TQ09QRU5BTUUgPSBgbGFuZ3VhZ2ViYWJlbC50dGxleHRlbnNpb25gO1xyXG5cclxuICBjb25zdHJ1Y3RvcihvYnNlcnZlQ29uZmlnID0gZmFsc2UpIHtcclxuICAgIGlmIChvYnNlcnZlQ29uZmlnKSAgIHtcclxuICAgICAgLy8gbG9vayBmb3IgY2hhbmdlcyBpbiB0YWdnZWQgdGVtcGxhdGUgaGFuZGxlcnNcclxuICAgICAgdGhpcy5kaXNwb3NhYmxlLmFkZChhdG9tLmNvbmZpZy5vYnNlcnZlKCdsYW5ndWFnZS1iYWJlbC50YWdnZWRUZW1wbGF0ZUdyYW1tYXInLCB0aGlzLm9ic2VydmVUdGxDb25maWcuYmluZCh0aGlzLCAxMDAwMCkpKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGRlc3Ryb3koKSB7XHJcbiAgICB0aGlzLmRpc3Bvc2FibGUuZGlzcG9zZSgpO1xyXG4gIH1cclxuXHJcbiAgLy8gYWRkIG5ldyBncmFtbWFycyB0byByZWdpc3RyeVxyXG4gIGFkZEdyYW1tYXJzKGZpbGVuYW1lKSB7XHJcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgICBhdG9tLmdyYW1tYXJzLmxvYWRHcmFtbWFyKGZpbGVuYW1lLCAoZXJyKSA9PiB7XHJcbiAgICAgICAgaWYgKGVycikge1xyXG4gICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihgVW5hYmxlIHRvIGFkZCBHcmFtbWFyIHRvIHJlZ2lzdHJ5XFxuJHtmaWxlbmFtZX1gKSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGVsc2UgcmVzb2x2ZSgpO1xyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG5cclxuICB9XHJcblxyXG4gIC8vIENoZWNrIGlmIHRoZSBncmFtbWFyIGV4aXN0cyB1bmRlciB0aGlzIFNIQTI1NiBmaWxlIG5hbWVcclxuICAvLyBJZiBub3QgdGhlbiByZW1vdmUgYWxsIHR0bCBncmFtbWFycyBhbmQgY3JlYXRlIGEgbmV3IG9uZVxyXG4gIC8vIFRoaXMgcmV0dXJucyBhIFByb21pc2UgdGhhdCByZXNvbHZlcyAgd2l0aCBhIHR0bCBmaWxlbmFtZVxyXG4gIC8vIGlmIGEgbmV3IGdyYW1tYXIgd2FzIGNyZWF0ZWQgb3IgcmVqZWN0cyBpZiBhIHByb2JsZW0uXHJcbiAgY3JlYXRlR3JhbW1hcih7dHRsRmlsZW5hbWUsIHR0bEZpbGVuYW1lQWJzb2x1dGUsIGdyYW1tYXJUZXh0fSkge1xyXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgICAgdGhpcy5kb2VzR3JhbW1hckZpbGVFeGlzdCh0dGxGaWxlbmFtZSlcclxuICAgICAgICAudGhlbigoaWZGaWxlRXhpc3RzKSA9PiB7XHJcbiAgICAgICAgICBpZiAoaWZGaWxlRXhpc3RzKSB7XHJcbiAgICAgICAgICAgIHJlc29sdmUoKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGVsc2Uge1xyXG4gICAgICAgICAgICB0aGlzLnJlbW92ZUdyYW1tYXJzKCk7XHJcbiAgICAgICAgICAgIHRoaXMucmVtb3ZlVHRsTGFuZ3VhZ2VGaWxlcygpXHJcbiAgICAgICAgICAgIC50aGVuKCgpID0+IHRoaXMuY3JlYXRlR3JhbW1hckZpbGUodHRsRmlsZW5hbWVBYnNvbHV0ZSwgZ3JhbW1hclRleHQpKVxyXG4gICAgICAgICAgICAudGhlbigoKSA9PiB0aGlzLmFkZEdyYW1tYXJzKHR0bEZpbGVuYW1lQWJzb2x1dGUpKVxyXG4gICAgICAgICAgICAudGhlbigoKSA9PiB7XHJcbiAgICAgICAgICAgICAgYXRvbS5ub3RpZmljYXRpb25zLmFkZEluZm8oJ2xhbmd1YWdlLWJhYmVsJywge2RldGFpbDogYEdyYW1tYXIgY3JlYXRlZCBhdCBcXG4ke3R0bEZpbGVuYW1lQWJzb2x1dGV9YCxkaXNtaXNzYWJsZTogdHJ1ZX0pO1xyXG4gICAgICAgICAgICAgIHJlc29sdmUodHRsRmlsZW5hbWUpO1xyXG4gICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAuY2F0Y2goKGVycikgPT4ge1xyXG4gICAgICAgICAgICAgIGF0b20ubm90aWZpY2F0aW9ucy5hZGRXYXJuaW5nKCdsYW5ndWFnZS1iYWJlbCcsIHtkZXRhaWw6IGAke2Vyci5tZXNzYWdlfWAsZGlzbWlzc2FibGU6IHRydWV9KTtcclxuICAgICAgICAgICAgICByZWplY3QoZXJyKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIC8vIHdyaXRlIHRoZSB0dGwgZ3JhbW1hciBmaWxlIGZvciB0aGlzIGNvbmZpZ1xyXG4gIGNyZWF0ZUdyYW1tYXJGaWxlKGZpbGVuYW1lLHRleHQpIHtcclxuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XHJcbiAgICAgIGZzLndyaXRlRmlsZShmaWxlbmFtZSwgdGV4dCwgKGVycikgPT4ge1xyXG4gICAgICAgIGlmIChlcnIpIHJlamVjdChuZXcgRXJyb3IoZXJyKSk7XHJcbiAgICAgICAgZWxzZSByZXNvbHZlKCk7XHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICAvLyBjcmVhdGUgYSBHcmFtbWFyIGZpbGUncyBKU09OIHRleHRcclxuICBjcmVhdGVHcmFtbWFyVGV4dCgpIHtcclxuICAgIHJldHVybiBge1xyXG4gIFwibmFtZVwiOiBcIiR7dGhpcy5UVExfR1JBTU1BUl9OQU1FfVwiLFxyXG4gIFwiY29tbWVudFwiOiBcIkF1dG8gZ2VuZXJhdGVkIFRhZyBFeHRlbnNpb25zIGZvciBsYW5ndWFnZS1iYWJlbFwiLFxyXG4gIFwiY29tbWVudFwiOiBcIlBsZWFzZSBkbyBub3QgZWRpdCB0aGlzIGZpbGUgZGlyZWN0bHlcIixcclxuICBcInNjb3BlTmFtZVwiOiBcIiR7dGhpcy5UVExfU0NPUEVOQU1FfVwiLFxyXG4gIFwiZmlsZVR5cGVzXCI6IFtdLFxyXG4gIFwicGF0dGVybnNcIjogW1xyXG4gICAgJHt0aGlzLmdldFR0bENvbmZpZygpLm1hcCgodHRsU3RyaW5nKSA9PiAodGhpcy5jcmVhdGVHcmFtbWFyUGF0dGVybnModHRsU3RyaW5nKSkpfVxyXG4gIF1cclxufWA7XHJcbiAgfVxyXG5cclxuICAvLyBDcmVhdGUgYSBncmFtbWFyJ3MgcGF0dGVybiBkZXJpdmVkIGZyb20gYSB0aGUgdGFnZ2VkIHRlbXBsYXRlIHN0cmluZ1xyXG4gIC8vIGluIHRoZSBmb3JtIG1hdGNoU3RyaW5nOmluY2x1ZGVTY29wZVxyXG4gIGNyZWF0ZUdyYW1tYXJQYXR0ZXJucyh0dGxTdHJpbmcpIHtcclxuICAgIGxldCBsYXN0Q29sb25JbmRleCA9IHR0bFN0cmluZy5sYXN0SW5kZXhPZignOicpO1xyXG4gICAgbGV0IG1hdGNoU3RyaW5nID0gdHRsU3RyaW5nLnN1YnN0cmluZygwLCBsYXN0Q29sb25JbmRleCk7XHJcbiAgICBsZXQgaW5jbHVkZVNjb3BlID0gdHRsU3RyaW5nLnN1YnN0cmluZyhsYXN0Q29sb25JbmRleCsxKTtcclxuICAgIGNvbnN0IGlzVmFsaWRJbmNsdWRlU2NvcGUgPSAvXihbYS16QS1aXVxcdypcXC4/KSooXFx3IyhbYS16QS1aXVxcdypcXC4/KSopP1xcdyQvLnRlc3QoaW5jbHVkZVNjb3BlKTtcclxuICAgIGNvbnN0IGlzUXVvdGVkTWF0Y2hTdHJpbmcgPSAvXlxcXCIuKlxcXCIkLy50ZXN0KG1hdGNoU3RyaW5nKTtcclxuXHJcbiAgICBpZiAobWF0Y2hTdHJpbmcubGVuZ3RoIDwgMSB8fCAhaXNWYWxpZEluY2x1ZGVTY29wZSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEVycm9yIGluIHRoZSBUYWdnZWQgVGVtcGxhdGUgR3JhbW1hciBTdHJpbmcgJHt0dGxTdHJpbmd9YCk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCBpc1F1b3RlZE1hdGNoU3RyaW5nICkge1xyXG4gICAgICAvLyBGb3VuZCBhIHBvc3NpYmxlIHJlZ2V4cCBpbiB0aGUgZm9ybSBcInJlZ2V4XCIgc28gc3RyaXAgdGhlIFwiXHJcbiAgICAgIG1hdGNoU3RyaW5nID0gbWF0Y2hTdHJpbmcuc3Vic3RyaW5nKDEsIG1hdGNoU3RyaW5nLmxlbmd0aCAtMSk7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgdGhpcy5vbmlndXJ1bWFDaGVjayhtYXRjaFN0cmluZyk7XHJcbiAgICAgICAgbWF0Y2hTdHJpbmcgPSBtYXRjaFN0cmluZy5yZXBsYWNlKC9cXFxcL2csXCJcXFxcXFxcXFwiKTsgLy8gXFwgdG8gXFxcXFxyXG4gICAgICAgIG1hdGNoU3RyaW5nID0gbWF0Y2hTdHJpbmcucmVwbGFjZSgvXFxcXFxcXFxbXCJdL2csXCJcXFxcXFxcXFxcXFxcXFwiXCIpOyAvLyBcXFxcXCIgdG8gXFxcXFxyXG4gICAgICB9XHJcbiAgICAgIGNhdGNoIChlcnIpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFlvdSBlbnRlcmVkIGFuIGJhZGx5IGZvcm1lZCBSZWdFeHAgaW4gdGhlIFRhZ2dlZCBUZW1wbGF0ZSBHcmFtbWFyIHNldHRpbmdzLlxcbiR7bWF0Y2hTdHJpbmd9XFxuJHtlcnJ9YCk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIGVsc2UgaWYgKCAvXCIvZy50ZXN0KG1hdGNoU3RyaW5nKSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEJhZCBsaXRlcmFsIHN0cmluZyBpbiB0aGUgVGFnZ2VkIFRlbXBsYXRlIEdyYW1tYXIgc2V0dGluZ3MuXFxuJHttYXRjaFN0cmluZ31gKTtcclxuICAgIH1cclxuICAgIGVsc2Uge1xyXG4gICAgICAvLyBVc2VyIGVudGVyZWQgYSBsaXRlcmFsIHN0cmluZyB3aGljaCBtYXkgY29udGFpbiBjaGFycyB0aGF0IGEgc3BlY2lhbCBpbnNpZGUgYSByZWdleC5cclxuICAgICAgLy8gRXNjYXBlIGFueSBzcGVjaWFsIGNoYXJzIGUuZy4gJy8qKiBAaHRtbCAqLycgLT4gJ1xcL1xcKlxcKiBAaHRtbCBcXCpcXC8nXHJcbiAgICAgIC8vIFRoZSBzdHJpbmcgc3RvcmVkIGJ5IEF0b20gaW4gdGhlIGNvbmZpZyBoYXMgdGhlIFxcXFwgYWxyZWFkeSBlc2NhcGVkLlxyXG4gICAgICBjb25zdCBlc2NhcGVTdHJpbmdSZWdFeHAgPSAvW3x7fSgpW1xcXV4kKyo/Ll0vZztcclxuICAgICAgY29uc3QgcHJlRXNjYXBlZFNsYXNoID0gL1xcXFwvZztcclxuICAgICAgbWF0Y2hTdHJpbmcgPSBtYXRjaFN0cmluZy5yZXBsYWNlKHByZUVzY2FwZWRTbGFzaCwgJ1xcXFxcXFxcXFxcXFxcXFwnKTtcclxuICAgICAgbWF0Y2hTdHJpbmcgPSBtYXRjaFN0cmluZy5yZXBsYWNlKGVzY2FwZVN0cmluZ1JlZ0V4cCwgJ1xcXFxcXFxcJCYnKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gYHtcclxuICAgICAgXCJjb250ZW50TmFtZVwiOiBcIiR7aW5jbHVkZVNjb3BlLm1hdGNoKC9eW14jXSovKVswXX1cIixcclxuICAgICAgXCJiZWdpblwiOiBcIlxcXFxcXFxccyorKCR7bWF0Y2hTdHJpbmd9KVxcXFxcXFxccyooXFxgKVwiLFxyXG4gICAgICBcImJlZ2luQ2FwdHVyZXNcIjoge1xyXG4gICAgICAgIFwiMVwiOiB7IFwibmFtZVwiOiBcImVudGl0eS5uYW1lLnRhZy5qc1wiIH0sXHJcbiAgICAgICAgXCIyXCI6IHsgXCJuYW1lXCI6IFwicHVuY3R1YXRpb24uZGVmaW5pdGlvbi5xdWFzaS5iZWdpbi5qc1wiIH1cclxuICAgICAgfSxcclxuICAgICAgXCJlbmRcIjogXCJcXFxcXFxcXHMqKD88PVteXFxcXFxcXFxcXFxcXFxcXF1cXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXHxbXlxcXFxcXFxcXFxcXFxcXFxdfF5cXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXHxeKSgoXFxgKSlcIixcclxuICAgICAgXCJlbmRDYXB0dXJlc1wiOiB7XHJcbiAgICAgICAgXCIxXCI6IHsgXCJuYW1lXCI6IFwicHVuY3R1YXRpb24uZGVmaW5pdGlvbi5xdWFzaS5lbmQuanNcIiB9XHJcbiAgICAgIH0sXHJcbiAgICAgIFwicGF0dGVybnNcIjogW1xyXG4gICAgICAgIHsgXCJpbmNsdWRlXCI6IFwic291cmNlLmpzLmpzeCNsaXRlcmFsLXF1YXNpLWVtYmVkZGVkXCIgfSxcclxuICAgICAgICB7IFwiaW5jbHVkZVwiOiBcIiR7aW5jbHVkZVNjb3BlfVwiIH1cclxuICAgICAgXVxyXG4gICAgfWA7XHJcbiAgfVxyXG5cclxuICAvLyBjaGVja3MgYSB0dGwgZ3JhbW1hciBmaWxlbmFtZSBleGlzdHNcclxuICAvLyByZXR1cm5zIGEgUHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRydWUgaWYgdHRsRmlsZU5hbWUgZXhpc3RzXHJcbiAgZG9lc0dyYW1tYXJGaWxlRXhpc3QodHRsRmlsZW5hbWUpIHtcclxuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xyXG4gICAgICBmcy5hY2Nlc3ModGhpcy5tYWtlVHRsR3JhbW1hckZpbGVuYW1lQWJzb3VsdXRlKHR0bEZpbGVuYW1lKSwgZnMuRl9PSywgKGVycikgPT4ge1xyXG4gICAgICAgIGVyciA/IHJlc29sdmUoZmFsc2UpOiByZXNvbHZlKHRydWUpO1xyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgLy8gZ2V0IGZ1bGwgcGF0aCB0byB0aGUgbGFuZ3VhZ2UtYmFiZWwgZ3JhbW1hciBmaWxlIGRpclxyXG4gIGdldEdyYW1tYXJQYXRoKCkge1xyXG4gICAgcmV0dXJuIHBhdGgubm9ybWFsaXplKFxyXG4gICAgICBwYXRoLnJlc29sdmUoYXRvbS5wYWNrYWdlcy5sb2FkZWRQYWNrYWdlc1snbGFuZ3VhZ2UtYmFiZWwnXS5wYXRoLCAnLi9ncmFtbWFycycpXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgLy8gZ2V0IGFuIGFycmF5IG9mIGFsbCBsYW5ndWFnZS1iYWJlbCBncmFtbWFyIGZpbGVzXHJcbiAgZ2V0R3JhbW1hckZpbGVzKCkge1xyXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLHJlamVjdCkgPT4ge1xyXG4gICAgICBmcy5yZWFkZGlyKHRoaXMuZ2V0R3JhbW1hclBhdGgoKSwoZXJyLCBkYXRhKSA9PiB7XHJcbiAgICAgICAgaWYgKGVycikgcmVqZWN0KG5ldyBFcnJvcihlcnIpKTtcclxuICAgICAgICBlbHNlIHtcclxuICAgICAgICAgIHJlc29sdmUoZGF0YSk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgLy8gcmVhZCBjb25maWd1cmF0aW9ucyBmb3IgdGFnZ2VkIHRlbXBsYXRlc1xyXG4gIGdldFR0bENvbmZpZygpIHtcclxuICAgIHJldHVybiBhdG9tLmNvbmZpZy5nZXQoJ2xhbmd1YWdlLWJhYmVsJykudGFnZ2VkVGVtcGxhdGVHcmFtbWFyO1xyXG4gIH1cclxuXHJcbiAgLy8gZ2V0IGFuIGFycmF5IG9mIGdyYW1tYXIgdGFnZ2VkIHRlbXBsYXRlIGV4dGVuc2lvbiBmaWxlbmFtZXNcclxuICBnZXRUdGxHcmFtbWFyRmlsZXMoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5nZXRHcmFtbWFyRmlsZXMoKS50aGVuKGRpckZpbGVzID0+IGRpckZpbGVzLmZpbHRlcihmdW5jdGlvbihmaWxlbmFtZSkge1xyXG4gICAgICByZXR1cm4gL150dGwtLy50ZXN0KGZpbGVuYW1lKTtcclxuICAgIH0pKTtcclxuICB9XHJcblxyXG4gIC8vIGdlbmVyYXRlIGEgU0hBMjU2IGZvciBzb21lIHRleHRcclxuICBnZW5lcmF0ZVR0bFNIQTI1NihzdHJpbmdUb0hhc2gpIHtcclxuICAgIGxldCBoYXNoID0gY3J5cHRvLmNyZWF0ZUhhc2goJ3NoYTI1NicpO1xyXG4gICAgaGFzaC51cGRhdGUoc3RyaW5nVG9IYXNoKTtcclxuICAgIHJldHVybiBoYXNoLmRpZ2VzdCgnaGV4Jyk7XHJcbiAgfVxyXG5cclxuICAvLyB0YWdnZWQgdGVtcGxhdGUgZmlsZW5hbWVcclxuICBtYWtlVHRsR3JhbW1hckZpbGVuYW1lKGhhc2hTdHJpbmcpIHtcclxuICAgIHJldHVybiBgdHRsLSR7aGFzaFN0cmluZ30uanNvbmA7XHJcbiAgfVxyXG5cclxuICAvLyBnZXQgYSBmdWxseSBxdWFsaWZpZWQgZmlsZW5hbWVcclxuICBtYWtlVHRsR3JhbW1hckZpbGVuYW1lQWJzb3VsdXRlKHR0bEZpbGVuYW1lKSB7XHJcbiAgICByZXR1cm4gcGF0aC5yZXNvbHZlKHRoaXMuZ2V0R3JhbW1hclBhdGgoKSwgdHRsRmlsZW5hbWUpO1xyXG4gIH1cclxuXHJcblxyXG4gIC8vIG9ic2VydmUgY2hhbmdlcyBpbiB0aGUgdGFnZ2VkVGVtcGxhdGVHcmFtbWFyIGNvbmZpZyB3aGljaCB0YWtlIHBsYWNlXHJcbiAgLy8gYmVjYXVzZSBvYnNlcnZlZCBjb25maWcgY2hhbmdlcyBhcmUgZmlyZWQgYXMgYSB1c2VyIHR5cGVzIHRoZW0gaW5zaWRlXHJcbiAgLy8gc2V0dGluZ3Mgd2UgbmVlZCB0byBkZWxheSBwcm9jZXNzaW5nIHRoZSBhcnJheSBzdHJpbmdzLCB1bnRpbCBsYXN0IGNoYXJcclxuICAvLyBlbnRlcmVkIHdhcyBzZXRUaW1lb3V0IHNlY29uZHMgYWdvLiBwYXJzZSB0YWdnZWQgdGVtcGxhdGUgY29uZmlndXJhdGlvblxyXG4gIC8vIGFuZCB0aGVuIGNyZWF0ZSBncmFtbWFyIGFuZCBnZW5lcmF0ZSBhIFNIQTI1NiBoYXNoIGZyb20gdGhlIGdyYW1tYXJcclxuICBvYnNlcnZlVHRsQ29uZmlnKHRpbWVvdXQpIHtcclxuICAgIGlmICh0aGlzLmNvbmZpZ0NoYW5nZWRUaW1lcikgY2xlYXJUaW1lb3V0KHRoaXMuY29uZmlnQ2hhbmdlZFRpbWVyKTtcclxuICAgIHRoaXMuY29uZmlnQ2hhbmdlZFRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgZ3JhbW1hclRleHQgPSB0aGlzLmNyZWF0ZUdyYW1tYXJUZXh0KCk7XHJcbiAgICAgICAgY29uc3QgaGFzaCA9IHRoaXMuZ2VuZXJhdGVUdGxTSEEyNTYoZ3JhbW1hclRleHQpO1xyXG4gICAgICAgIGNvbnN0IHR0bEZpbGVuYW1lID0gdGhpcy5tYWtlVHRsR3JhbW1hckZpbGVuYW1lKGhhc2gpO1xyXG4gICAgICAgIGNvbnN0IHR0bEZpbGVuYW1lQWJzb2x1dGUgPSB0aGlzLm1ha2VUdGxHcmFtbWFyRmlsZW5hbWVBYnNvdWx1dGUodHRsRmlsZW5hbWUpO1xyXG4gICAgICAgIHRoaXMuY3JlYXRlR3JhbW1hcih7dHRsRmlsZW5hbWUsIHR0bEZpbGVuYW1lQWJzb2x1dGUsIGdyYW1tYXJUZXh0fSk7XHJcbiAgICAgIH1cclxuICAgICAgY2F0Y2goZXJyKSB7XHJcbiAgICAgICAgYXRvbS5ub3RpZmljYXRpb25zLmFkZFdhcm5pbmcoJ2xhbmd1YWdlLWJhYmVsJywge2RldGFpbDogYCR7ZXJyLm1lc3NhZ2V9YCxkaXNtaXNzYWJsZTogdHJ1ZX0pO1xyXG4gICAgICB9XHJcbiAgICB9LCB0aW1lb3V0KTtcclxuICB9XHJcblxyXG4gIC8vIHZhbGlkYXRlIGEgcmVnZXggd2l0aCBhIE9uaWd1cnVtYS4gVGhpcyB3aWxsIHRocm93IGlmIGl0IGZhaWxzIHRoZSBjaGVja3NcclxuICAvLyBUaGlzIHdpbGwgcmV0dXJuIHRydWUgaWYgdGhlIGNoZWNrIHBhc3NlcyBvciBmYWxzZSBpZiBubyBvbmlndXJ1bWEgd2FzIGZvdW5kXHJcbiAgb25pZ3VydW1hQ2hlY2socmVnZXgpIHtcclxuICAgIGxldCBpc1JlZ2V4VmFsaWQgPSBmYWxzZTtcclxuICAgIC8vIFdlIG5lZWQgdG8gY2FsbCBvbmlndXJ1bWEncyBjb25zdHJ1Y3RvciB2aWEgdGhpcyBjb252b2x1dGVkIG1ldGhvZCBhcyBJIGNhbid0IGluY2x1ZGVcclxuICAgIC8vIHRoZSBnaXRodWIvYXRvbS9ub2RlLW9uaWd1cnVtYSBwYWNrYWdlIGFzIG5wbSBvbiBXaW5kb3dzIGdldCBub2RlLWd5cCBlcnJvcnMgdW5sZXNzIGFcclxuICAgIC8vIHVzZXIgaGFzIGluc3RhbGxlZCBhIGNvbXBpbGVyLiBGaW5kIEF0b20ncyBPbmlndXJ1bWEgYW5kIGNhbGwgdGhlIGNvbnN0cnVjdG9yLlxyXG4gICAgaWYgKHR5cGVvZiBhdG9tLmdyYW1tYXJzLmdyYW1tYXJzID09PSBcIm9iamVjdFwiKSB7XHJcbiAgICAgIGF0b20uZ3JhbW1hcnMuZ3JhbW1hcnMuZXZlcnkoKG9iaikgPT4ge1xyXG4gICAgICAgIGlmIChvYmoubmFtZSA9PT0gXCJCYWJlbCBFUzYgSmF2YVNjcmlwdFwiKSB7XHJcbiAgICAgICAgICBsZXQgcmVmLCByZWYxLCByZWYyO1xyXG4gICAgICAgICAgaWYgKChyZWYgPSBvYmouZmlyc3RMaW5lUmVnZXgpICE9IG51bGwpIHtcclxuICAgICAgICAgICAgaWYgKChyZWYxID0gcmVmLnNjYW5uZXIpICE9IG51bGwpIHtcclxuICAgICAgICAgICAgICBpZiAoKHJlZjIgPSByZWYxLl9fcHJvdG9fXykgIT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZiByZWYyLmNvbnN0cnVjdG9yID09PSBcImZ1bmN0aW9uXCIpIHtcclxuICAgICAgICAgICAgICAgICAgLy8gbm93IGNhbGwgbmV3IG9iai5maXJzdExpbmVSZWdleC5zY2FubmVyLl9fcHJvdG9fXy5jb25zdHJ1Y3Rvcihbb25pZ1N0cmluZ10pO1xyXG4gICAgICAgICAgICAgICAgICAvLyB0byB2YWxpZGF0ZSB0aGUgcmVnZXhcclxuICAgICAgICAgICAgICAgICAgbmV3IHJlZjIuY29uc3RydWN0b3IoW3JlZ2V4XSk7XHJcbiAgICAgICAgICAgICAgICAgIGlzUmVnZXhWYWxpZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGVsc2UgcmV0dXJuIHRydWU7XHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGlzUmVnZXhWYWxpZDtcclxuICB9XHJcblxyXG4gIC8vIFJlbW92ZSBncmFtbWFycyBiZWZvcmUgdXBvZGF0aW5nXHJcbiAgcmVtb3ZlR3JhbW1hcnMoKSB7XHJcbiAgICBhdG9tLmdyYW1tYXJzLnJlbW92ZUdyYW1tYXJGb3JTY29wZU5hbWUodGhpcy5UVExfU0NPUEVOQU1FKTtcclxuICB9XHJcblxyXG4gIC8vIHJlbW92ZSBhbGwgbGFuZ3VhZ2UgZmlsZXMgaW4gdGFnZ2VkIHRlbXBsYXRlIEdyYW1tYXJGaWxlcyBhcnJheVxyXG4gIHJlbW92ZVR0bExhbmd1YWdlRmlsZXMoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5nZXRUdGxHcmFtbWFyRmlsZXMoKS50aGVuKCh0dGxHcmFtbWFyRmlsZXMpID0+IHtcclxuICAgICAgZm9yIChsZXQgdHRsR3JhbW1hckZpbGVuYW1lIG9mIHR0bEdyYW1tYXJGaWxlcykge1xyXG4gICAgICAgIGxldCB0dGxHcmFtbWFyRmlsZUFic291bHRlID0gdGhpcy5tYWtlVHRsR3JhbW1hckZpbGVuYW1lQWJzb3VsdXRlKHR0bEdyYW1tYXJGaWxlbmFtZSk7XHJcbiAgICAgICAgZnMudW5saW5rKHR0bEdyYW1tYXJGaWxlQWJzb3VsdGUpO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuXHJcbiAgfVxyXG59O1xyXG4iXX0=