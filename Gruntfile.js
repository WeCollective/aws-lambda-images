module.exports = function(grunt) {
  // Load tasks
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-exec');
  grunt.loadNpmTasks('grunt-zip');

  // Configure tasks
  grunt.initConfig({
    // javascript linting
    jshint: {
      files: ['Gruntfile.js', 'UserImages.js'],
      options: {
        node: true // tell jshint we are using nodejs to avoid incorrect errors
      }
    },
    // execute shell commands
    exec: {
      deploy: 'aws lambda update-function-code --function-name UserImages --zip-file fileb://UserImages.zip --region eu-west-1 --profile weco'
    },
    zip: {
      'UserImages.zip': ['UserImages.js', 'node_modules/*']
    }
  });

  /* Register main tasks.
  **    grunt build           lints the js
  */
  grunt.registerTask('build', ['jshint', 'zip']);
  grunt.registerTask('deploy', ['build', 'exec:deploy']);
};
