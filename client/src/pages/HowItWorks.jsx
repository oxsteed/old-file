      {/* Trust Bar */}
      <section className="bg-gray-900 border-y border-gray-800 py-12 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-2xl md:text-3xl font-bold text-white">Helpers With Real Skills</h2>
            <p className="text-gray-400 text-sm md:text-base max-w-2xl mx-auto mt-2">
              Find local helpers with the practical skills to handle everyday jobs around your home and property.
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-3 text-sm">
            {[
              'Handyman Work',
              'Cleaning',
              'Moving Help',
              'Yard Work',
              'Painting',
              'Plumbing',
              'Electrical',
              'Furniture Assembly',
              'Landscaping',
              'General Labor',
              'Tool Rental',
              'Home Maintenance',
            ].map((skill) => (
              <span
                key={skill}
                className="px-4 py-2 rounded-full bg-gray-800 border border-gray-700 text-gray-300 hover:border-orange-500 hover:text-white transition"
              >
                {skill}
              </span>
            ))}
          </div>
        </div>
      </section>
