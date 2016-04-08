/* eslint arrow-body-style: 0 */
'use strict';

const Repository = require('nodegit').Repository;
const path = require('path');
const cwd = process.cwd();
const conventionalCommitsParser = require('conventional-commits-parser');

module.exports = function getScopesFromLog(someConfig) {
  const config = someConfig || {};

  return Repository.open(path.resolve(config.cwd || cwd))
    .then(repo => repo.getMasterCommit())
    .then((firstCommitOnMaster) => {
      return new Promise((resolve, reject) => {
        const history = firstCommitOnMaster.history();
        const commits = [];

        history
          .on('commit', commit => commits.push(commit))
          .on('end', () => resolve(commits))
          .on('error', (err) => reject(err))
          .start();
      });
    })
    .then((commits) => {
      return commits
        .map(commit => conventionalCommitsParser.sync(commit.message(), config))
        .reduce((result, commit) => {
          if (!commit.scope) {
            return result;
          }

          let scope = result
            .find(scopeObj => scopeObj.name === commit.scope);

          if (!scope) {
            scope = {
              occurence: 0,
              withTypes: [],
              name: commit.scope,
            };

            result.push(scope);
          }

          scope.occurence += 1;

          if (scope.withTypes.indexOf(commit.type) === -1) {
            scope.withTypes.push(commit.type);
          }

          return result;
        }, [])
        .sort((a, b) => {
          if (a.occurence > b.occurence) {
            return -1;
          } else if (a.occurence > b.occurence) {
            return 1;
          }

          return 0;
        });
    });
};
