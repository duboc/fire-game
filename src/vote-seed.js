// Boot-time setup for Live Vote, so the app works the moment it starts. The
// admin replaces both from /vote/admin. Accents, apostrophes, multi-part and
// repeated first names are deliberate: they are what the search has to handle.
export const SEED_NAMES = Object.freeze([
  'Ana Souza', 'João Pedro Silva', "Lucas D'Ávila", 'Mariana Costa', 'Bruno Lima',
  'Carla Dias', 'Élio Santos', 'Zoë Ribeiro', 'Rafael Oliveira', 'Beatriz Almeida',
  'Gabriel Ferreira', 'Juliana Rocha', 'Thiago Martins', 'Camila Barbosa', 'Felipe Carvalho',
  'Larissa Gomes', 'Gustavo Pereira', 'Fernanda Ribas', 'Rodrigo Nunes', 'Patrícia Moreira',
  'Diego Cardoso', 'Letícia Araújo', 'Matheus Teixeira', 'Aline Correia', 'Vinícius Mendes',
  'Natália Pinto', 'Leonardo Castro', 'Isabela Fonseca', 'André Vieira', 'Renata Monteiro',
  'Marcelo Freitas', 'Tatiane Ramos', 'Eduardo Lopes', 'Priscila Azevedo', 'Henrique Duarte',
  'Vanessa Cunha', 'Ricardo Batista', 'Bianca Machado', 'Daniel Rezende', 'Luana Farias',
  'Paulo Siqueira', 'Gabriela Tavares', 'Fábio Moura', 'Sofia Andrade', 'Caio Medeiros',
  'Helena Brandão', 'Otávio Pires', 'Clara Bezerra', 'Samuel Coelho', 'Lívia Guimarães',
  'Igor Antunes', 'Yasmin Peixoto', 'Murilo Sales', 'Débora Xavier', 'Arthur Campos',
  'Raquel Morais', 'Enzo Prado', 'Manuela Leite', 'Hugo Barros', 'Alícia Matos',
  'Emma Müller', "Liam O'Connor", 'Noah Schmidt', 'Olivia Brown', 'Chloé Dubois',
  'Mateo García', 'Lucía Fernández', 'Hiroshi Tanaka', 'Yuki Sato', 'Priya Patel',
  'Arjun Sharma', 'Minh Nguyễn', 'Wei Zhang', 'Fatima Al-Sayed', 'Omar Haddad',
  'Ingrid Johansson', 'Lars Nielsen', 'Søren Madsen', 'Anouk de Vries', 'Giulia Romano',
  'Marco Bianchi', 'Aleksandra Nowak', 'Mikhail Ivanov', 'Zeynep Yılmaz', 'Kwame Mensah',
  'Amara Okafor', 'Thandiwe Dlamini', 'Diego Hernández', 'Valentina Russo', 'Sebastián Morales',
  'Isabelle Laurent', 'Théo Martin', 'Camille Bernard', 'Nicolás Torres', 'Martina Gómez',
  'Jonas Weber', 'Lea Fischer', 'Ana Luísa Pacheco', 'Anabela Rocha', 'Mariane Alves',
  'João Vitor Lacerda', 'Maria Eduarda Quintela', 'Pedro Henrique Salgado', 'Ana Clara Vasconcelos', 'Luiz Felipe Brito',
  'Maria Fernanda Godoy', 'Carlos Eduardo Paiva', 'Júlia Bittencourt', 'Rafaela Sampaio', 'Gonçalo Esteves',
  'Inês Magalhães', 'Tomás Figueiredo', 'Beatriz Couto', 'Kenji Watanabe', 'Mei Lin',
  'Sana Qureshi', 'Elif Demir', 'Nadia Benali', 'Oscar Lindqvist', 'Ruby Thompson',
]);

export const SEED_CATEGORIES = Object.freeze([
  { title: 'MVP of the Year', picks: 3 },
  { title: 'Most Helpful', picks: 3 },
  { title: 'Best Leader', picks: 3 },
  { title: 'Most Creative', picks: 3 },
  { title: 'Rising Star', picks: 3 },
]);
