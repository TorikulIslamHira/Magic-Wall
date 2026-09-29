using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MagicWall.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class LinkCandidatesToSeats : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ConstituencyId",
                table: "Candidates",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Candidates_ConstituencyId",
                table: "Candidates",
                column: "ConstituencyId");

            migrationBuilder.AddForeignKey(
                name: "FK_Candidates_Constituencies_ConstituencyId",
                table: "Candidates",
                column: "ConstituencyId",
                principalTable: "Constituencies",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            // Existing candidates stand in the seat where they already have votes.
            migrationBuilder.Sql("""
                UPDATE Candidates
                SET ConstituencyId = (SELECT r.ConstituencyId FROM ElectionResults r
                                      WHERE r.CandidateId = Candidates.Id LIMIT 1)
                WHERE ConstituencyId IS NULL;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Candidates_Constituencies_ConstituencyId",
                table: "Candidates");

            migrationBuilder.DropIndex(
                name: "IX_Candidates_ConstituencyId",
                table: "Candidates");

            migrationBuilder.DropColumn(
                name: "ConstituencyId",
                table: "Candidates");
        }
    }
}
